const NodeHelper = require("node_helper");
const fetch = require("node-fetch");

module.exports = NodeHelper.create({
  start: function () {
    console.log("Starting node helper for MMM-Todoist (2026 Unified API)");
  },

  socketNotificationReceived: async function (notification, payload) {
    if (notification === "GET_TODOIST_TASKS") {
      try {
        const response = await fetch("https://api.todoist.com/api/v1/sync", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${payload.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sync_token: "*",
            resource_types: ["projects", "items", "collaborators"] 
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Status ${response.status}: ${errorText}`);
        }

        const data = await response.json();

        // Send data to the main module
        this.sendSocketNotification("TODOIST_TASKS", {
          tasks: data.items || [],      
          projects: data.projects || [],
        });
      } catch (error) {
        console.error("MMM-Todoist Helper Error:", error);
        this.sendSocketNotification("TODOIST_ERROR", error.message);
      }
    }
  },
});