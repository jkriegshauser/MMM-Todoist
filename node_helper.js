const NodeHelper = require("node_helper");
const https = require("https");

module.exports = NodeHelper.create({
  tokens: {},

  socketNotificationReceived: function (notification, payload) {
    if (notification === "GET_TODOIST_TASKS") {
      const self = this;
      const id = payload.instanceID;
      
      if (payload.forceFull || !this.tokens[id]) this.tokens[id] = "*";

      const postData = JSON.stringify({
        sync_token: this.tokens[id],
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
              self.tokens[id] = parsed.sync_token;
              self.sendSocketNotification("TODOIST_TASKS_" + id, {
                tasks: parsed.items || [],
                projects: parsed.projects || [],
                fullSync: payload.forceFull,
                rawResponse: parsed // Passing this back for browser logging
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