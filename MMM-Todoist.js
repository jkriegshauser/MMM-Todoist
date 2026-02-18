/* global Module */

Module.register("MMM-Todoist", {
  defaults: {
    accessToken: "",
    maximumEntries: 15,
    updateInterval: 5 * 60 * 1000,
    projects: [],
    sortType: "todoist", 
    displayTasksWithinDays: -1,
    displayTasksWithoutDue: true,
    groupByProject: true,
    showHeaders: true,
    showPriorityColumn: true
  },

  getStyles: function () { return ["MMM-Todoist.css"]; },

  start: function () {
    this.tasks = [];
    this.allTasks = [];
    this.projects = {};
    this.instanceID = this.identifier;
    this.fetchTasks(true); 
    setInterval(() => { this.fetchTasks(false); }, this.config.updateInterval);
  },

  fetchTasks: function (force) {
    this.sendSocketNotification("GET_TODOIST_TASKS", {
      accessToken: this.config.accessToken,
      instanceID: this.instanceID,
      forceFull: force
    });
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "TODOIST_TASKS_" + this.instanceID) {
      this.processData(payload);
      this.updateDom();
    }
  },

  processData: function (data) {
    if (data.projects) {
      data.projects.forEach(p => this.projects[String(p.id)] = p);
    }

    const targetProjects = this.config.projects.map(p => String(p));
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    let cutOffDate = null;
    if (this.config.displayTasksWithinDays > -1) {
      cutOffDate = new Date(now);
      cutOffDate.setDate(now.getDate() + this.config.displayTasksWithinDays);
      cutOffDate.setHours(23, 59, 59, 999);
    }

    // --- FILTERING: Project Match + Strict Date Window ---
    const filteredTasks = data.tasks.filter(t => {
      if (!targetProjects.includes(String(t.project_id))) return false;
      if (!t.due) return this.config.displayTasksWithoutDue;

      if (cutOffDate) {
        const taskDateStr = (t.due.date || t.due.datetime).substring(0, 10);
        const taskDate = new Date(taskDateStr + "T00:00:00");
        return taskDate <= cutOffDate;
      }
      return true;
    });

    if (data.fullSync || this.allTasks.length === 0) {
      this.allTasks = filteredTasks;
    } else {
      filteredTasks.forEach(newTask => {
        const index = this.allTasks.findIndex(t => t.id === newTask.id);
        if (newTask.is_deleted || newTask.checked) {
          if (index > -1) this.allTasks.splice(index, 1);
        } else {
          if (index > -1) this.allTasks[index] = newTask;
          else this.allTasks.push(newTask);
        }
      });
    }

    // --- PRECISION CLOCK-FIRST SORTING ---
    this.allTasks.sort((a, b) => {
      const getDueInfo = (due) => {
        if (!due) return { date: "9999-99-99", full: "", isTimed: false };
        const raw = due.datetime || due.date || "";
        return { date: raw.substring(0, 10), full: raw, isTimed: raw.length > 10 };
      };
      const A = getDueInfo(a.due);
      const B = getDueInfo(b.due);
      if (A.date !== B.date) return A.date.localeCompare(B.date);
      if (A.isTimed !== B.isTimed) return A.isTimed ? -1 : 1;
      if (A.isTimed && B.isTimed) {
        if (A.full !== B.full) return A.full.localeCompare(B.full);
      }
      if (a.priority !== b.priority) return b.priority - a.priority;
      const orderA = a.item_order !== undefined ? a.item_order : (a.child_order || 0);
      const orderB = b.item_order !== undefined ? b.item_order : (b.child_order || 0);
      return orderA - orderB;
    });

    this.tasks = this.allTasks.slice(0, this.config.maximumEntries);
  },

  getDueLabelAndClass: function (due) {
    const raw = due.datetime || due.date || "";
    const taskDate = new Date(raw.substring(0, 10) + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffDays = Math.floor((taskDate - today) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { label: "Overdue", className: "dueOverdue bright", isDimmed: false };
    if (diffDays === 0) return { label: "Today", className: "dueToday bright", isDimmed: false };
    if (diffDays === 1) return { label: "Tomorrow", className: "dueTomorrow dimmed", isDimmed: true };
    
    if (diffDays < 7) {
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      return { label: dayNames[taskDate.getDay()], className: "dueUpcoming dimmed", isDimmed: true };
    }

    return { label: raw.substring(0, 10), className: "dueFuture dimmed", isDimmed: true };
  },

  getDom: function () {
    const wrapper = document.createElement("div");
    if (!this.allTasks.length) { wrapper.innerHTML = "<em>Loading...</em>"; return wrapper; }

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
          const hRow = document.createElement("div");
          hRow.className = "divTableRow";
          const hCell = document.createElement("div");
          hCell.className = "projectHeaderCell";
          hCell.textContent = this.projects[pidStr]?.name || "Project";
          hRow.appendChild(hCell);
          container.appendChild(hRow);

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
    
    let dueInfo = null;
    if (task.due) {
      dueInfo = this.getDueLabelAndClass(task.due);
      if (dueInfo.isDimmed) {
        row.classList.add("dimmed");
      }
    }

    if (this.config.showPriorityColumn) {
      const pCell = document.createElement("div");
      pCell.className = "priority priority" + (5 - (task.priority || 1));
      row.appendChild(pCell);
    }

    const cCell = document.createElement("div");
    cCell.className = "todoTextCell alignLeft";
    cCell.textContent = task.content;
    row.appendChild(cCell);

    const dCell = document.createElement("div");
    dCell.className = "dueDate";
    if (dueInfo) {
      dCell.textContent = dueInfo.label;
      dCell.classList.add(...dueInfo.className.split(" "));
    }
    row.appendChild(dCell);
    
    return row;
  }
});