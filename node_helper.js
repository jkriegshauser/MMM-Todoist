const NodeHelper = require("node_helper");
const fetch = require("node-fetch");

module.exports = NodeHelper.create({
  start: function () {
    console.log("Starting node helper for MMM-Todoist (REST API v1)");
  },

  socketNotificationReceived: async function (notification, payload) {
    if (notification === "GET_TODOIST_TASKS") {
      try {
        const [tasks, projects] = await Promise.all([
          this.fetchTasks(payload.accessToken),
          this.fetchProjects(payload.accessToken),
        ]);

        this.sendSocketNotification("TODOIST_TASKS", {
          tasks: tasks,
          projects: projects,
          labels: {}, // No labels fetched anymore
          user: {}, // REST API v2 has no user endpoint
        });
      } catch (error) {
        console.error("MMM-Todoist: API error:", error);
        this.sendSocketNotification("TODOIST_ERROR", error.message);
      }
    }
  },

  fetchTasks: async function (accessToken) {
    const url = "https://api.todoist.com/rest/v1/tasks";
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch tasks: ${response.status} ${errorText}`);
    }

    return response.json();
  },

  fetchProjects: async function (accessToken) {
    const url = "https://api.todoist.com/rest/v1/projects";
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch projects: ${response.status} ${errorText}`);
    }

    return response.json();
  },

  // Removed fetchLabels function entirely
});
