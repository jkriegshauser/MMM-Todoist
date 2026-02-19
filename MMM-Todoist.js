/* global Module */

Module.register("MMM-Todoist", {
  defaults: {
    accessToken: "",
    maximumEntries: 15,
    updateInterval: 5 * 60 * 1000,
    projects: [],
    displayTasksWithinDays: -1,
    displayTasksWithoutDue: true,
    groupByProject: true,
    showHeaders: true,
    showPriorityColumn: true,
    selfIdentifier: null
  },

  getStyles: function () { return ["MMM-Todoist.css"]; },

  start: function () {
    this.tasks = [];
    this.allTasks = []; 
    this.projects = {};
    this.errorMessage = null;
    this.instanceID = this.config.selfIdentifier || this.identifier;
    this.isFetching = false;

    setTimeout(() => { this.fetchTasks(true); }, 2000);
    setInterval(() => { this.fetchTasks(false); }, this.config.updateInterval);
  },

  fetchTasks: function (force) {
    if (this.isFetching) return;
    this.isFetching = true;
    this.sendSocketNotification("GET_TODOIST_TASKS", {
      accessToken: this.config.accessToken,
      instanceID: this.instanceID,
      forceFull: force
    });
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "TODOIST_TASKS_" + this.instanceID) {
      this.isFetching = false;
      this.errorMessage = null;

      // Force recovery if we are stuck on loading but payload came back empty
      if (this.allTasks.length === 0 && (!payload.tasks || payload.tasks.length === 0)) {
        setTimeout(() => { this.fetchTasks(true); }, 10000);
        return;
      }

      try {
        this.processData(payload);
        this.updateDom();
      } catch (e) {
        console.error("MMM-Todoist Critical Process Error: ", e);
      }
    }
    
    if (notification === "TODOIST_ERROR_" + this.instanceID) {
      this.isFetching = false;
      this.errorMessage = payload.type;
      this.updateDom();
    }
  },

  processData: function (data) {
    if (!data) return;

    // Stability: Only skip if this is a partial update with 0 items
    if (!data.fullSync && (!data.tasks || data.tasks.length === 0)) {
        return; 
    }

    if (data.projects) {
      data.projects.forEach(p => { this.projects[String(p.id)] = p; });
    }

    if (data.fullSync || this.allTasks.length === 0) {
      this.allTasks = data.tasks || [];
    } else if (data.tasks && data.tasks.length > 0) {
      data.tasks.forEach(updatedTask => {
        const index = this.allTasks.findIndex(t => t.id === updatedTask.id);
        if (updatedTask.is_deleted || updatedTask.checked) {
          if (index > -1) this.allTasks.splice(index, 1);
        } else {
          if (index > -1) this.allTasks[index] = updatedTask;
          else this.allTasks.push(updatedTask);
        }
      });
    }

    const targetProjects = this.config.projects.map(p => String(p));
    
    // SAFE FILTERING
    const filtered = this.allTasks.filter(t => {
      try {
        const pMatch = targetProjects.includes(String(t.project_id));
        if (!pMatch) return false;

        if (!t.due) return this.config.displayTasksWithoutDue;
        
        if (this.config.displayTasksWithinDays > -1) {
          const now = new Date();
          now.setHours(0, 0, 0, 0);
          const cutOff = new Date(now);
          cutOff.setDate(now.getDate() + this.config.displayTasksWithinDays);
          cutOff.setHours(23, 59, 59, 999);

          const taskDateStr = (t.due.date || t.due.datetime || "").substring(0, 10);
          if (!taskDateStr) return this.config.displayTasksWithoutDue;
          const taskDate = new Date(taskDateStr + "T00:00:00");
          return taskDate <= cutOff;
        }
        return true;
      } catch (e) { return false; }
    });

    // SAFE SORTING
    filtered.sort((a, b) => {
      try {
        const getDueInfo = (due) => {
          if (!due) return { date: "9999-99-99", full: "", isTimed: false };
          const raw = due.datetime || due.date || "";
          return { date: raw.substring(0, 10), full: raw, isTimed: raw.length > 10 };
        };
        const A = getDueInfo(a.due);
        const B = getDueInfo(b.due);
        if (A.date !== B.date) return A.date.localeCompare(B.date);
        if (A.isTimed !== B.isTimed) return A.isTimed ? -1 : 1;
        if (a.priority !== b.priority) return b.priority - a.priority;
        return (a.item_order || 0) - (b.item_order || 0);
      } catch (e) { return 0; }
    });

    this.tasks = filtered.slice(0, this.config.maximumEntries);
  },

  getDueLabelAndClass: function (due) {
    const raw = due.datetime || due.date || "";
    if (!raw) return { label: "", classes: [], isDimmed: true };
    const taskDate = new Date(raw.substring(0, 10) + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((taskDate - today) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { label: "Overdue", classes: ["dueOverdue", "bright"], isDimmed: false };
    if (diffDays === 0) return { label: "Today", classes: ["dueToday", "bright"], isDimmed: false };
    if (diffDays === 1) return { label: "Tomorrow", classes: ["dueTomorrow", "dimmed"], isDimmed: true };
    if (diffDays < 7) {
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      return { label: dayNames[taskDate.getDay()], classes: ["dueUpcoming", "dimmed"], isDimmed: true };
    }
    return { label: raw.substring(0, 10), classes: ["dueFuture", "dimmed"], isDimmed: true };
  },

  getDom: function () {
    const wrapper = document.createElement("div");
    if (this.errorMessage) {
      wrapper.innerHTML = "<em style='color:#ff4444'>Todoist " + this.errorMessage + "</em>";
      return wrapper;
    }
    
    // If we have tasks in memory but filtering killed them all
    if (this.allTasks.length > 0 && this.tasks.length === 0) {
        wrapper.innerHTML = "<div class='dimmed' style='padding:10px;'>No tasks matching filters.</div>";
        return wrapper;
    }

    if (this.allTasks.length === 0) {
      wrapper.innerHTML = "<em>Loading tasks...</em>";
      return wrapper;
    }

    const container = document.createElement("div");
    container.className = "divTable";
    
    if (this.config.groupByProject) {
      const grouped = {};
      this.tasks.forEach(t => {
        const pId = String(t.project_id);
        if (!grouped[pId]) grouped[pId] = [];
        grouped[pId].push(t);
      });

      this.config.projects.forEach(pId => {
        const pidStr = String(pId);
        if (grouped[pidStr]) {
          if (this.config.showHeaders !== false) {
            const hRow = document.createElement("div");
            hRow.className = "divTableRow";
            const hCell = document.createElement("div");
            hCell.className = "projectHeaderCell";
            hCell.textContent = this.projects[pidStr] ? this.projects[pidStr].name : pidStr;
            hRow.appendChild(hCell);
            container.appendChild(hRow);
          }
          grouped[pidStr].forEach(t => container.appendChild(this.renderTaskRow(t)));
        }
      });
    } else {
      this.tasks.forEach(t => container.appendChild(this.renderTaskRow(t)));
    }
    wrapper.appendChild(container);
    return wrapper;
  },

  renderTaskRow: function (task) {
    const row = document.createElement("div");
    row.className = "divTableRow";
    let dueInfo = task.due ? this.getDueLabelAndClass(task.due) : null;
    if (dueInfo && dueInfo.isDimmed) row.classList.add("dimmed");
    if (this.config.showPriorityColumn) {
      const pCell = document.createElement("div");
      pCell.className = "priority priority" + (5 - (task.priority || 1));
      row.appendChild(pCell);
    }
    const cCell = document.createElement("div");
    cCell.className = "todoTextCell alignLeft";
    cCell.textContent = task.content || "Untitled Task";
    row.appendChild(cCell);
    const dCell = document.createElement("div");
    dCell.className = "dueDate";
    if (dueInfo) {
      dCell.textContent = dueInfo.label;
      if (dueInfo.classes) {
        dueInfo.classes.forEach(cls => dCell.classList.add(cls));
      }
    }
    row.appendChild(dCell);
    return row;
  }
});