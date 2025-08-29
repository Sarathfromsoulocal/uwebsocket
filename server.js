// node server.js
const uWS = require('uWebSockets.js');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const http = require("http");

const adminClients = new Set();  // store client IDs of admins
const clients = new Map();       // store all clients
const urls = new Set();
let logs = [];

// add log entry
function addLog(msg) {
    logs.push({ time: new Date().toISOString(), message: msg });
    if (logs.length > 1000) logs.shift();
    console.log("[LOG]", msg);
}

uWS.App().ws('/*', {
    // new connection
    open: (ws) => {
        const clientId = uuidv4();
        ws.clientId = clientId;   // attach ID to the socket
        clients.set(clientId, ws);

        addLog(`Client connected with ID: ${clientId}. Total clients: ${clients.size}`);
    },

    // message received
    message: (ws, message, isBinary) => {
        try {
            const msgText = Buffer.from(message).toString();
            const in_message = JSON.parse(msgText);

            addLog(`Received from ${ws.clientId}: ${msgText}`);

            if (in_message.message?.message === 'Client Connected!') {
                const data = { message: { client_id: ws.clientId, message: in_message } };
                if (in_message.url) {
                    urls.add(in_message.url);
                    axios.post(in_message.url + 'web/chat_view_socket_reciver', data, {
                        headers: { 'Content-Type': 'application/json' }
                    })
                    .then(r => addLog(`Forwarded to ${in_message.url}`))
                    .catch(e => addLog(`Error posting to ${in_message.url}: ${e.message}`));
                }
                addLog(`Connected Customer App Client ID : ${ws.clientId}`);
            } 
            else if (in_message.message === 'Hello Server!') {
                adminClients.add(ws.clientId);
                try {
                    ws.send(JSON.stringify({
                        client_id: ws.clientId,
                        message: { message: `You are now marked as an admin, client ${ws.clientId}` }
                    }));
                } catch {}
                addLog(`Connected Admin ID : ${ws.clientId}`);
            }

            // send to a specific client
            if (in_message.client_id) {
                const target = clients.get(in_message.client_id);
                if (target) {
                    try {
                        target.send(JSON.stringify(in_message));
                        addLog(`Sent to ${in_message.client_id}`);
                    } catch {
                        addLog(`Failed to send to ${in_message.client_id}`);
                    }
                } else {
                    try {
                        ws.send(JSON.stringify({ status: "Closed" }));
                    } catch {}
                }
            } 
            // otherwise, forward to all admins
            else {
                adminClients.forEach((adminId) => {
                    const admin = clients.get(adminId);
                    if (admin) {
                        try {
                            admin.send(JSON.stringify({ client_id: ws.clientId, message: in_message }));
                        } catch {}
                    }
                });
            }
        } catch (error) {
            addLog(`Message parse error from ${ws.clientId}: ${error.message}`);
            urls.forEach(url => {
                axios.post(url + '/admin/sent_whatsapp_admin',
                    JSON.stringify({ status: "Error Web Socket Server : " + error.message }),
                    { headers: { 'Content-Type': 'application/json' } }
                ).catch(() => {});
            });
        }
    },

    // client disconnected
    close: (ws, code, msg) => {
        if (!ws.clientId) return;

        clients.delete(ws.clientId);
        adminClients.delete(ws.clientId);

        adminClients.forEach((adminId) => {
            const admin = clients.get(adminId);
            if (admin) {
                try {
                    admin.send(JSON.stringify({
                        client_id: ws.clientId,
                        message: { message: { message: 'Client Disconnected!' } }
                    }));
                } catch {}
            }
        });

        addLog(`Client with ID ${ws.clientId} disconnected. Total clients: ${clients.size}`);
    }
}).listen(9001, (token) => {
    if (token) {
        console.log('✅ WebSocket server listening on ws://localhost:9001');
    } else {
        console.log('❌ Failed to listen to port 9001');
    }
});



// --- HTTP Server (log viewer + API) ---
http.createServer((req, res) => {
    if (req.url.startsWith("/logs")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(logs));
    } else if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
        <html>
            <head>
                <meta charset="UTF-8">
                <title>Logs</title>
                <style>
                    body {
                        font-family: monospace;
                        margin: 0;
                        height: 100vh;
                        display: flex;
                        flex-direction: column;
                    }
                    #header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        background: #f4f4f4;
                        padding: 10px;
                        border-bottom: 1px solid #ccc;
                    }
                    #filters {
                        display: flex;
                        gap: 10px;
                        align-items: center;
                    }
                    #controls {
                        display: flex;
                        gap: 10px;
                    }
                    #logs {
                        flex: 1;
                        white-space: pre;
                        padding: 10px;
                        overflow: auto;
                        background: #fff;
                    }
                    body.night #logs {
                        background: #111;
                        color: #0f0;
                    }
                </style>
            </head>
            <body>
                <div id="header">
                    <div id="filters">
                        <label>Date: <input type="date" id="date"></label>
                        <label>Time: <input type="time" id="time"></label>
                        <label>To Date: <input type="date" id="toDate"></label>
                        <label>To Time: <input type="time" id="toTime"></label>
                        <label>Search: <input type="text" id="search"></label>
                        <button onclick="loadLogs()">Filter</button>
                    </div>
                    <div id="controls">
                        <button id="refreshBtn" onclick="toggleRefresh()">⏸️ Pause</button>
                        <button onclick="toggleNightMode()">🌙 Night</button>
                    </div>
                </div>
                <div id="logs"></div>A

                <script>
                    let refreshInterval = setInterval(loadLogs, 2000);

                    function formatDateTime(iso) {
                        const d = new Date(iso);
                        const pad = n => n.toString().padStart(2, "0");
                        return pad(d.getDate()) + "-" + pad(d.getMonth()+1) + "-" + d.getFullYear() +
                                " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) +
                                "." + d.getMilliseconds().toString().padStart(2,"0");
                    }

                    async function loadLogs() {
                        const res = await fetch('/logs');
                        let data = await res.json();

                        const date = document.getElementById("date").value;
                        const time = document.getElementById("time").value;
                        const toDate = document.getElementById("toDate").value;
                        const toTime = document.getElementById("toTime").value;
                        const search = document.getElementById("search").value.toLowerCase();

                        let from = date ? new Date(date + "T" + (time || "00:00")) : null;
                        let to = toDate ? new Date(toDate + "T" + (toTime || "23:59")) : null;

                        if (from) data = data.filter(l => new Date(l.time) >= from);
                        if (to) data = data.filter(l => new Date(l.time) <= to);
                        if (search) data = data.filter(l => l.message.toLowerCase().includes(search));

                        document.getElementById("logs").innerText =
                            data.map(l => "[" + formatDateTime(l.time) + "] " + l.message).join("\\n");
                    }

                    function toggleRefresh() {
                        const btn = document.getElementById("refreshBtn");
                        if (refreshInterval) {
                            clearInterval(refreshInterval);
                            refreshInterval = null;
                            btn.innerText = "▶️ Resume";
                        } else {
                            refreshInterval = setInterval(loadLogs, 2000);
                            btn.innerText = "⏸️ Pause";
                        }
                    }

                    function toggleNightMode() {
                        document.body.classList.toggle("night");
                    }

                    loadLogs();
                </script>
            </body>
        </html>
        `);
    } else {
        res.writeHead(404);
        res.end("Not Found");
    }
}).listen(3000, () => {
    console.log("✅ Log viewer running at http://localhost:3000");
});
