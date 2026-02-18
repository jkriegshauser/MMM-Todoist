const NodeHelper = require("node_helper");
const https = require("https");

module.exports = NodeHelper.create({
  socketNotificationReceived: function (notification, payload) {
    if (notification === "GET_TODOIST_TASKS") {
      const self = this;
      const id = payload.instanceID;
      const postData = JSON.stringify({
        sync_token: "*", // Forces full sync every time for reliability
        resource_types: ["projects", "items"]
      });
      const options = {
        hostname: "api.todoist.com",
        port: 443,
        path: "/api/v1/sync",
        method: "POST",
        headers: {
          "Authorization": "Bearer " + payload.accessToken,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData)
        }
      };
      const req = https.request(options, (res) => {
        let body = "";
        res.on("data", (d) => { body += d; });
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(body);
              self.sendSocketNotification("TODOIST_TASKS_" + id, {
                tasks: parsed.items || [],
                projects: parsed.projects || []
              });
            } catch (e) { console.error("Todoist Helper Error", e); }
          }
        });
      });
      req.write(postData);
      req.end();
    }
  }
});