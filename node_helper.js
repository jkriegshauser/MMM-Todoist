const NodeHelper = require("node_helper");
const https = require("https");

module.exports = NodeHelper.create({
  tokens: {},

  socketNotificationReceived: function (notification, payload) {
    if (notification === "GET_TODOIST_TASKS") {
      const id = payload.instanceID || "unknown";
      
      // FORCE RESET: If the module asks for a full sync, clear the stored token
      if (payload.forceFull) {
        this.tokens[id] = "*";
      }

      const syncToken = this.tokens[id] || "*";
      
      console.log(`[MMM-Todoist] Request: ${id} | Token: ${syncToken.substring(0, 10)}...`);

      const postData = JSON.stringify({
        sync_token: syncToken,
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
        console.log(`[MMM-Todoist] API Response for ${id}: ${res.statusCode}`);
        
        res.on("data", (d) => { body += d; });
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(body);
              
              // Store the new sync token for the NEXT partial update
              this.tokens[id] = parsed.sync_token;
              
              const taskCount = parsed.items ? parsed.items.length : 0;
              console.log(`[MMM-Todoist] Sending ${taskCount} tasks to ${id}`);
              
              this.sendSocketNotification("TODOIST_TASKS_" + id, {
                tasks: parsed.items || [],
                projects: parsed.projects || [],
                fullSync: (syncToken === "*")
              });
            } catch (e) { 
                console.error("[MMM-Todoist] JSON Parse Error for " + id);
                this.sendSocketNotification("TODOIST_ERROR_" + id, { type: "JSON_ERR" });
            }
          } else {
            // Handle 429 (Rate Limit) or 401 (Unauthorized)
            console.error(`[MMM-Todoist] API Error: ${res.statusCode} for ${id}`);
            this.sendSocketNotification("TODOIST_ERROR_" + id, { type: res.statusCode });
          }
        });
      });

      req.on("error", (err) => { 
        console.error(`[MMM-Todoist] Connection Error: ${err.message}`);
        this.sendSocketNotification("TODOIST_ERROR_" + id, { type: "CONN_ERR" }); 
      });

      req.write(postData);
      req.end();
    }
  }
});