/* global Module, Log */

Module.register("MMM-Todoist", {
  defaults: {
    maximumEntries: 50,
    updateInterval: 10 * 60 * 1000, 
    projects: [],               
    showProject: true,         
    displayTasksWithinDays: 0,  
    displayTasksWithoutDue: false, 
    maxTitleLength: 50,         
    accessToken: "",
    wrapEvents: true,           
    showPriorityColumn: true,
    sortByPriority: true,
    groupByProject: true,
    showDueDateLabels: true,     
    showHeaders: true,           
  },

  getStyles: function () {
    return ["MMM-Todoist.css"];
  },

  start: function () {
    Log.info("Starting module: " + this.name);
    this.tasks = [];
    this.projects = {};
    this.sendSocketNotification("GET_TODOIST_TASKS", { accessToken: this.config.accessToken });
    setInterval(() => {
      this.sendSocketNotification("GET_TODOIST_TASKS", { accessToken: this.config.accessToken });
    }, this.config.updateInterval);
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "TODOIST_TASKS") {
      this.processData(payload);
      this.updateDom();
    } else if (notification === "TODOIST_ERROR") {
      Log.error("MMM-Todoist: API error:", payload);
    }
  },

  processData: function (data) {
    this.projects = {};
    if (data.projects) {
      data.projects.forEach(proj => { this.projects[String(proj.id)] = proj; });
    }

    let tasks = data.tasks || [];

    // 2026 Project Filter Fix
    if (this.config.projects.length > 0) {
      const projectSet = new Set(this.config.projects.map(String));
      tasks = tasks.filter(task => projectSet.has(String(task.project_id)));
    }

    // 2026 Date Filter Fix (Time-Agnostic)
    const now = new Date();
    const todayStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0') + "-" + String(now.getDate()).padStart(2, '0');

    tasks = tasks.filter(task => {
      if (!task.due) return this.config.displayTasksWithoutDue;
      const taskDateStr = (task.due.date || task.due.datetime).substring(0, 10);
      if (this.config.displayTasksWithinDays === 0) {
        return taskDateStr <= todayStr;
      } else {
        const cutoff = new Date();
        cutoff.setDate(now.getDate() + this.config.displayTasksWithinDays);
        const cutoffStr = cutoff.getFullYear() + "-" + String(cutoff.getMonth() + 1).padStart(2, '0') + "-" + String(cutoff.getDate()).padStart(2, '0');
        return taskDateStr <= cutoffStr;
      }
    });

    this.tasks = tasks.sort((a, b) => (a.priority || 4) - (b.priority || 4));
    if (this.config.maximumEntries > 0) this.tasks = this.tasks.slice(0, this.config.maximumEntries);
  },

  // Helper for original date labels
  getDueLabelAndClass: function (due) {
    const taskDateStr = (due.date || due.datetime).substring(0, 10);
    const now = new Date();
    const todayStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0') + "-" + String(now.getDate()).padStart(2, '0');
    
    if (taskDateStr < todayStr) return { label: "Overdue", className: "dueOverdue" };
    if (taskDateStr === todayStr) return { label: "Today", className: "dueToday" };
    
    return { label: taskDateStr, className: "dueFuture" };
  },

  getDom: function () {
    const wrapper = document.createElement("div");
    if (this.tasks.length === 0) {
      wrapper.innerHTML = "<em>No tasks for today.</em>";
      return wrapper;
    }

    const container = document.createElement("div");
    container.className = "divTable";

    const tasksByProject = {};
    this.tasks.forEach(task => {
      const projId = String(task.project_id);
      if (!tasksByProject[projId]) tasksByProject[projId] = [];
      tasksByProject[projId].push(task);
    });

    Object.keys(tasksByProject).forEach(projId => {
      const projName = this.projects[projId] ? this.projects[projId].name : "Project";
      
      // RESTORED: Original Header Style
      const projectHeader = document.createElement("div");
      projectHeader.className = "divTableRow projectHeader";
      projectHeader.innerHTML = `<div class="divTableCell projectHeaderCell" style="font-weight:bold; padding:8px 0;">${projName}</div>`;
      container.appendChild(projectHeader);

      if (this.config.showHeaders) {
        const headerRow = document.createElement("div");
        headerRow.className = "divTableRow divTableHeadingRow";
        headerRow.innerHTML = `
          ${this.config.showPriorityColumn ? '<div class="divTableHead priority">P</div>' : ''}
          <div class="divTableHead todoTextCell">Task</div>
          <div class="divTableHead dueDate">Due</div>
        `;
        container.appendChild(headerRow);
      }

      const body = document.createElement("div");
      body.className = "divTableBody";

      tasksByProject[projId].forEach(task => {
        const row = document.createElement("div");
        row.className = "divTableRow";

        if (this.config.showPriorityColumn) {
          const pCell = document.createElement("div");
          pCell.className = "divTableCell priority priority" + (task.priority || 4);
          row.appendChild(pCell);
        }

        const cCell = document.createElement("div");
        cCell.className = "divTableCell todoTextCell alignLeft";
        cCell.textContent = task.content;
        row.appendChild(cCell);

        const dCell = document.createElement("div");
        dCell.className = "divTableCell dueDate";
        if (task.due) {
          const { label, className } = this.getDueLabelAndClass(task.due);
          dCell.textContent = label;
          dCell.classList.add(className);
        }
        row.appendChild(dCell);

        body.appendChild(row);
      });
      container.appendChild(body);
    });

    wrapper.appendChild(container);
    return wrapper;
  }
});