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
    sortType: "todoist",         
    groupByProject: true,
    showDueDateLabels: true,     
    showHeaders: true,           
  },

  getStyles: () => ["MMM-Todoist.css"],

  start: function () {
    this.tasks = [];
    this.projects = {};
    this.sendSocketNotification("GET_TODOIST_TASKS", { accessToken: this.config.accessToken });
    setInterval(() => this.sendSocketNotification("GET_TODOIST_TASKS", { accessToken: this.config.accessToken }), this.config.updateInterval);
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "TODOIST_TASKS") {
      this.processData(payload);
      this.updateDom();
    }
  },

  processData: function (data) {
    this.projects = {};
    if (data.projects) {
      data.projects.forEach(proj => { this.projects[String(proj.id)] = proj; });
    }

    let tasks = data.tasks || [];

    // 1. Project Filter
    if (this.config.projects.length > 0) {
      const projectSet = new Set(this.config.projects.map(String));
      tasks = tasks.filter(task => projectSet.has(String(task.project_id)));
    }

    // 2. Date Filtering (Today/Overdue)
    const now = new Date();
    const todayStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0') + "-" + String(now.getDate()).padStart(2, '0');

    tasks = tasks.filter(task => {
      if (!task.due) return this.config.displayTasksWithoutDue;
      const taskDateStr = (task.due.date || task.due.datetime).substring(0, 10);
      return taskDateStr <= todayStr;
    });

    // 3. SORT: Priority (Descending) then Child Order (Ascending)
    tasks.sort((a, b) => {
      // API P4=Web P1, API P1=Web P4. Sort descending to put API 4 at top.
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      const orderA = a.item_order !== undefined ? a.item_order : (a.child_order || 0);
      const orderB = b.item_order !== undefined ? b.item_order : (b.child_order || 0);
      return orderA - orderB;
    });

    this.tasks = tasks;
    if (this.config.maximumEntries > 0) this.tasks = this.tasks.slice(0, this.config.maximumEntries);
  },

  getDueLabelAndClass: function (due) {
    const taskDateStr = (due.date || due.datetime).substring(0, 10);
    const now = new Date();
    const todayStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0') + "-" + String(now.getDate()).padStart(2, '0');
    if (taskDateStr < todayStr) return { label: "Overdue", className: "dueOverdue" };
    return { label: "Today", className: "dueToday" };
  },

  getDom: function () {
    const wrapper = document.createElement("div");
    if (!this.tasks.length) { wrapper.innerHTML = "<em>No tasks for today.</em>"; return wrapper; }

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
      const projectHeader = document.createElement("div");
      projectHeader.className = "divTableRow projectHeader";
      projectHeader.innerHTML = `<div class="divTableCell projectHeaderCell" style="font-weight:bold; padding:8px 0;">${projName}</div>`;
      container.appendChild(projectHeader);

      const body = document.createElement("div");
      body.className = "divTableBody";

      tasksByProject[projId].forEach(task => {
        const row = document.createElement("div");
        row.className = "divTableRow";

        if (this.config.showPriorityColumn) {
          const pCell = document.createElement("div");
          // MAP API 4 to CSS 1, API 3 to CSS 2, etc.
          const cssPriority = 5 - (task.priority || 1);
          pCell.className = "divTableCell priority priority" + cssPriority;
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