/* global Module, Log */

Module.register("MMM-Todoist", {
  defaults: {
    maximumEntries: 30,
    updateInterval: 10 * 60 * 1000, // every 10 minutes
    fade: false,
    projects: [],               // array of project IDs to filter by
    showProject: false,         // show project name column
    displayTasksWithinDays: 0,  // 0 = no limit, otherwise filter tasks due within this many days
    displayTasksWithoutDue: false, // show tasks without due date
    displayAvatar: true,        // not currently used but kept for compatibility
    maxTitleLength: 50,         // truncate long titles if wrapEvents false
    accessToken: "",
    sortType: "dueDateDescPriority", // (not currently used)
    wrapEvents: true,           // if false, truncate task content
    useSmallFont: false,        // for CSS styling
    showPriorityColumn: true,
    sortByPriority: true,
    groupByProject: false,
    showDueDateLabels: true,     // show due date labels like "Today", "Overdue", etc
    showHeaders: true,           // Toggle column headers on or off
  },

  getStyles: function () {
    return ["MMM-Todoist.css"];
  },

  start: function () {
    Log.info("Starting module: " + this.name);
    this.tasks = [];
    this.projects = {};
    this.labels = {};
    this.user = {};
    this.lastUpdated = null;

    this.sendSocketNotification("GET_TODOIST_TASKS", {
      accessToken: this.config.accessToken,
      projects: this.config.projects
    });

    this.scheduleUpdate();
  },

  scheduleUpdate: function () {
    setInterval(() => {
      this.sendSocketNotification("GET_TODOIST_TASKS", {
        accessToken: this.config.accessToken,
        projects: this.config.projects
      });
    }, this.config.updateInterval);
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "TODOIST_TASKS") {
      // Expect payload to be { tasks: [...], projects: [...], labels: [...], user: {...} }
      this.processData(payload);
      this.updateDom();
    } else if (notification === "TODOIST_ERROR") {
      Log.error("MMM-Todoist: API error:", payload);
    }
  },

processData: function (data) {
  // Reset projects, labels, user
  this.projects = {};
  if (Array.isArray(data.projects)) {
    data.projects.forEach(proj => {
      this.projects[proj.id] = proj;
    });
  }

  this.labels = {};
  if (Array.isArray(data.labels)) {
    data.labels.forEach(label => {
      this.labels[label.id] = label;
    });
  }

  this.user = data.user || {};

  let tasks = data.tasks || data.items || []; // accept both keys just in case

  // Filter tasks by project IDs if any configured
  if (this.config.projects.length > 0) {
    const projectSet = new Set(this.config.projects.map(p => String(p)));
    tasks = tasks.filter(task => projectSet.has(String(task.project_id)));
  }

  // Filter by due date window if set
  if (this.config.displayTasksWithinDays > 0) {
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setDate(now.getDate() + this.config.displayTasksWithinDays);

    tasks = tasks.filter(task => {
      if (!task.due) return this.config.displayTasksWithoutDue;
      const dueDate = this.parseDueDateLocal(task.due);
      return dueDate && dueDate <= cutoff;
    });
  } else if (this.config.displayTasksWithinDays === 0) {
    // Show only overdue or due today tasks
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    tasks = tasks.filter(task => {
      if (!task.due) return this.config.displayTasksWithoutDue;
      const dueDate = this.parseDueDateLocal(task.due);
      if (!dueDate) return false;

      // Normalize due date to local date only (no time)
      const dueDateOnly = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

      return dueDateOnly <= today;
    });
  } else if (!this.config.displayTasksWithoutDue) {
    // Only show tasks with due date if no window and config disallows no-due
    tasks = tasks.filter(task => task.due);
  }

  // Sort tasks using your full sort logic
  this.tasks = this.sortTasks(tasks);

  // Limit tasks if needed
  if (this.config.maximumEntries > 0) {
    this.tasks = this.tasks.slice(0, this.config.maximumEntries);
  }

  this.lastUpdated = new Date();

  Log.info(`Processed ${this.tasks.length} tasks after filtering and sorting.`);
},


  sortTasks: function (tasks) {
    return tasks.sort((a, b) => {
      const aDue = this.parseDueDateLocal(a.due);
      const bDue = this.parseDueDateLocal(b.due);

      // Calculate weighted scores based on due date and priority
      const aScore = this.calculateTaskScore(aDue, a.priority);
      const bScore = this.calculateTaskScore(bDue, b.priority);

      // Primary sort by weighted score (due date + priority)
      if (aScore < bScore) return -1;
      if (aScore > bScore) return 1;

      // Secondary sort by content if scores are equal
      return a.content.localeCompare(b.content);
    });
  },

  calculateTaskScore: function (dueDate, priority) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    if (!dueDate) {
      // Tasks without due date get a very high score (appear at the end)
      return 1000000;
    }

    // Normalize due date to local date only (no time)
    const dueDateOnly = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    
    // Calculate days from today (negative for overdue, 0 for today, positive for future)
    const daysDiff = Math.floor((dueDateOnly - today) / (1000 * 60 * 60 * 24));
    
    // Base score: days difference * 1000 (creates large gaps between different due dates)
    let score = daysDiff * 1000;
    
    // Add priority component (1-4, where 1 is highest priority)
    // Higher priority (lower number) should result in lower score for proper sorting
    // Priority 1 (highest) = 10, Priority 4 (lowest) = 40
    const priorityScore = (priority || 4) * 10;
    score -= priorityScore;
    
    return score;
  },

  parseDueDateLocal: function (due) {
    if (!due) return null;
    if (due.datetime) {
      return new Date(due.datetime);
    } else if (due.date) {
      const parts = due.date.split("-");
      return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    return null;
  },

  getDueLabelAndClass: function (due) {
    const dueDate = this.parseDueDateLocal(due);
    if (!dueDate) return { label: "", className: "" };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const dueDateOnly = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

    if (dueDateOnly < today) {
      return { label: "Overdue", className: "dueOverdue" };
    } else if (dueDateOnly.getTime() === today.getTime()) {
      return { label: "Today", className: "dueToday" };
    } else if (dueDateOnly.getTime() === tomorrow.getTime()) {
      return { label: "Tomorrow", className: "dueTomorrow" };
    }

    return { label: this.formatDueDate(due), className: "dueFuture" };
  },

  // New helper method: calculate widest project name width (defensive)
  calculateProjectNameColumnWidth: function () {
    if (!this.tasks || this.tasks.length === 0) {
      return 120; // fallback width if no tasks
    }

    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.visibility = "hidden";
    container.style.height = "auto";
    container.style.width = "auto";
    container.style.whiteSpace = "nowrap";
    document.body.appendChild(container);

    let maxWidth = 0;
    const fontStyle = "14px Arial, sans-serif"; // Adjust if your CSS uses different font/size

    // Collect unique project names from current tasks
    const projectNames = new Set();
    this.tasks.forEach(task => {
      const name = this.projects[task.project_id] ? this.projects[task.project_id].name : "";
      if (name) projectNames.add(name);
    });

    if (projectNames.size === 0) {
      document.body.removeChild(container);
      return 120;
    }

    projectNames.forEach(name => {
      const span = document.createElement("span");
      span.style.font = fontStyle;
      span.textContent = name;
      container.appendChild(span);
      const width = span.getBoundingClientRect().width;
      if (width > maxWidth) maxWidth = width;
      container.removeChild(span);
    });

    document.body.removeChild(container);

    const padding = 24; // Adjust for your CSS cell padding/margin
    return maxWidth + padding;
  },

  getDom: function () {
    const wrapper = document.createElement("div");

    if (!this.tasks || this.tasks.length === 0) {
      wrapper.innerHTML = "<em>No tasks to display.</em>";
      return wrapper;
    }

    // Calculate project column width only for non-grouped view with project column shown
    if (!this.config.groupByProject && this.config.showProject) {
      this.projectColumnWidth = this.calculateProjectNameColumnWidth();
      Log.info("MMM-Todoist: Calculated projectColumnWidth:", this.projectColumnWidth);
    } else {
      this.projectColumnWidth = null;
    }

    if (this.config.groupByProject) {
      // Grouped view unchanged
      const tasksByProject = {};
      this.tasks.forEach(task => {
        const projId = task.project_id || "No Project";
        if (!tasksByProject[projId]) tasksByProject[projId] = [];
        tasksByProject[projId].push(task);
      });

      const container = document.createElement("div");
      container.className = "divTable";
      container.style.width = "100%";

      Object.keys(tasksByProject).forEach(projId => {
        const projectName = this.projects[projId] ? this.projects[projId].name : "No Project";

        const projectHeader = document.createElement("div");
        projectHeader.className = "divTableRow projectHeader";
        projectHeader.style.textAlign = "center";

        const headerCell = document.createElement("div");
        headerCell.className = "divTableCell projectHeaderCell";
        headerCell.style.flex = "1";
        headerCell.style.fontWeight = "bold";
        headerCell.style.padding = "8px 0";
        headerCell.textContent = projectName;

        projectHeader.appendChild(headerCell);
        container.appendChild(projectHeader);

        if (this.config.showHeaders) {
          const headerRow = document.createElement("div");
          headerRow.className = "divTableRow divTableHeadingRow";

          if (this.config.showPriorityColumn) {
            const priorityHead = document.createElement("div");
            priorityHead.className = "divTableHead priority";
            priorityHead.textContent = "Priority";
            headerRow.appendChild(priorityHead);
          }

          // No project column here

          const taskHead = document.createElement("div");
          taskHead.className = "divTableHead todoTextCell";
          taskHead.textContent = "Task";
          headerRow.appendChild(taskHead);

          const dueHead = document.createElement("div");
          dueHead.className = "divTableHead dueDate";
          dueHead.textContent = "Due";
          headerRow.appendChild(dueHead);

          container.appendChild(headerRow);
        }

        const projectTasks = document.createElement("div");
        projectTasks.className = "divTableBody";

        tasksByProject[projId].forEach(task => {
          const row = this.createTaskRowGrouped(task);
          projectTasks.appendChild(row);
        });

        container.appendChild(projectTasks);
      });

      wrapper.appendChild(container);
      return wrapper;
    }

    // Non-grouped view

    const table = document.createElement("div");
    table.className = "divTable";
    table.style.width = "100%";

    if (this.config.showHeaders) {
      const header = document.createElement("div");
      header.className = "divTableRow divTableHeadingRow";

      if (this.config.showPriorityColumn) {
        const priorityHeader = document.createElement("div");
        priorityHeader.className = "divTableHead priority";
        priorityHeader.textContent = "Priority";
        header.appendChild(priorityHeader);
      }

      if (this.config.showProject) {
        const projectHeader = document.createElement("div");
        projectHeader.className = "divTableHead projectName";
        projectHeader.textContent = "Project";
        if (this.projectColumnWidth && this.projectColumnWidth > 0) {
          projectHeader.style.flex = `0 0 ${this.projectColumnWidth}px`;
        }
        header.appendChild(projectHeader);
      }

      const taskHeader = document.createElement("div");
      taskHeader.className = "divTableHead todoTextCell";
      taskHeader.textContent = "Task";
      header.appendChild(taskHeader);

      const dueHeader = document.createElement("div");
      dueHeader.className = "divTableHead dueDate";
      dueHeader.textContent = "Due";
      header.appendChild(dueHeader);

      table.appendChild(header);
    }

    this.tasks.forEach(task => {
      const row = this.createTaskRow(task);
      table.appendChild(row);
    });

    wrapper.appendChild(table);
    return wrapper;
  },

  createTaskRowGrouped: function (task) {
    const row = document.createElement("div");
    row.className = "divTableRow";

    if (this.config.showPriorityColumn) {
      const priorityCell = document.createElement("div");
      priorityCell.className = "divTableCell priority";
      priorityCell.classList.add("priority" + (task.priority || 4));
      row.appendChild(priorityCell);
    }

    let content = task.content || "";
    if (!this.config.wrapEvents && content.length > this.config.maxTitleLength) {
      content = content.substring(0, this.config.maxTitleLength) + "...";
    }

    const contentCell = document.createElement("div");
    contentCell.className = "divTableCell todoTextCell alignLeft";
    contentCell.textContent = content;
    if (!this.config.wrapEvents) {
	  contentCell.classList.add("nowrap");
	} else {
	  contentCell.style.whiteSpace = "normal";
	  contentCell.style.wordBreak = "break-word"; // optional: wrap mid-word if needed
	}
    row.appendChild(contentCell);

    const dueCell = document.createElement("div");
    dueCell.className = "divTableCell dueDate";
    if (task.due) {
      if (this.config.showDueDateLabels) {
        const { label, className } = this.getDueLabelAndClass(task.due);
        dueCell.textContent = label;
        dueCell.classList.add(className);
      } else {
        dueCell.textContent = this.formatDueDate(task.due);
      }
    }
    dueCell.style.textAlign = "center";
    row.appendChild(dueCell);

    return row;
  },

  createTaskRow: function (task) {
    const row = document.createElement("div");
    row.className = "divTableRow";

    if (this.config.showPriorityColumn) {
      const priorityCell = document.createElement("div");
      priorityCell.className = "divTableCell priority";
      let priority = parseInt(task.priority);
      if (!(priority >= 1 && priority <= 4)) {
        priority = 4;
      }
      priorityCell.classList.add("priority" + priority);
      row.appendChild(priorityCell);
    }

    if (this.config.showProject) {
      const projectCell = document.createElement("div");
      projectCell.className = "divTableCell projectName";
      projectCell.textContent = this.projects[task.project_id] ? this.projects[task.project_id].name : "";
      if (this.projectColumnWidth && this.projectColumnWidth > 0) {
        projectCell.style.flex = `0 0 ${this.projectColumnWidth}px`;
      }
      row.appendChild(projectCell);
    }

    let content = task.content || "";
    if (!this.config.wrapEvents && content.length > this.config.maxTitleLength) {
      content = content.substring(0, this.config.maxTitleLength) + "...";
    }

    const contentCell = document.createElement("div");
    contentCell.className = "divTableCell todoTextCell alignLeft";
    if (!this.config.wrapEvents) {
      contentCell.classList.add("nowrap");
    }
    contentCell.textContent = content;
    row.appendChild(contentCell);

    const dueCell = document.createElement("div");
    dueCell.className = "divTableCell dueDate";

    if (task.due) {
      if (this.config.showDueDateLabels) {
        const { label, className } = this.getDueLabelAndClass(task.due);
        dueCell.textContent = label;
        dueCell.classList.add(className);
      } else {
        dueCell.textContent = this.formatDueDate(task.due);
      }
    }
    row.appendChild(dueCell);

    return row;
  },

  formatDueDate: function (due) {
    if (!due) return "";
    const dt = due.datetime ? new Date(due.datetime) : new Date(due.date);
    return dt.toLocaleDateString();
  }
});
