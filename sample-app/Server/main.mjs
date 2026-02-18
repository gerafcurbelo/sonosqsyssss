import { Server } from "socket.io";
import { createServer } from "http";
import express from "express";
import axios from "axios";

/*
 * This file defines and initiates the server that listens for Sonos API events, along with the WebSocket connection between the server
 *    and client that allows the server to send events to the client.
 * Sonos API sends events to the ngrok URL, which the server receives at port 8080. The server then sends this request to the WebSocket at port 8000
 * The client can then receive that event in MuseEventHandler by listening to "ws://localhost:8000" (see socket.js)
 *
 * Q-SYS Integration:
 *   - GET  /api/status  -> Returns current track name, artist, and play state (for Q-SYS polling)
 *   - POST /api/config  -> Receives { token, groupId } from the web client after group selection
 *   - POST /api/play    -> Sends play command to Sonos (called from Q-SYS)
 *   - POST /api/pause   -> Sends pause command to Sonos (called from Q-SYS)
 *   - POST /api/toggle  -> Toggles play/pause (called from Q-SYS)
 */

// In-memory state updated from Sonos webhook events
let sonosState = {
  trackName: "",
  artistName: "",
  containerName: "",
  isPlaying: false,
  groupId: null,
  token: null
};

// Sonos Control API base URL (without CORS proxy since server-side calls don't need it)
const SONOS_CONTROL_API = "https://api.ws.sonos.com/control/api/v1/groups/";

// Defines WebSocket connection between client and server
const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

// Initiates WebSocket connection
httpServer.listen(8000);

// Logs messages and connections from the client
io.on("connection", (socket) => {
  console.log("Connected to client...", socket.id);
  socket.on("hello from client", (data) => {
    console.log(data);
  });
});

/**
 * Sends data from server to client through WebSocket connection
 * @param data Data received from Sonos API event
 */
function sendRequest(data) {
  io.emit("message from server", data);
}

/**
 * Parses Sonos webhook event and updates in-memory sonosState
 * @param headers {object} Request headers from Sonos API
 * @param data {object} Request body from Sonos API
 */
function updateStateFromEvent(headers, data) {
  const eventType = headers["x-sonos-type"];

  if (eventType === "metadataStatus") {
    sonosState.trackName = data.currentItem?.track?.name || "";
    sonosState.artistName = data.currentItem?.track?.artist?.name || "";
    sonosState.containerName = data.container?.name || "";
    console.log(`[State] Track updated: "${sonosState.trackName}" by "${sonosState.artistName}"`);
  } else if (eventType === "playbackStatus") {
    sonosState.isPlaying =
      data.playbackState === "PLAYBACK_STATE_PLAYING" ||
      data.playbackState === "PLAYBACK_STATE_BUFFERING";
    console.log(`[State] Playback state: ${sonosState.isPlaying ? "PLAYING" : "PAUSED"}`);
  }
}

/**
 * Calls the Sonos Control API using the stored token and groupId
 * @param action {string} Sonos API action path (e.g. "playback/play")
 * @returns {Promise}
 */
async function callSonosAPI(action) {
  if (!sonosState.token || !sonosState.groupId) {
    throw new Error("No token or groupId configured. Open the web app and select a group first.");
  }
  const url = SONOS_CONTROL_API + sonosState.groupId + "/" + action;
  return axios.post(url, {}, {
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + sonosState.token
    }
  });
}


// Defines and initiates server that listens to incoming Sonos API events
const app = express();
const PORT = 8080;
app.listen(PORT, (error) => {
  if (!error)
    console.log(
      "Server is Successfully Running, and App is listening on port " + PORT
    );
  else console.log("Error occurred, server can't start", error);
});
app.use(
  express.urlencoded({
    extended: true,
  })
);
app.use(express.json());
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});


// ─── Sonos Webhook ─────────────────────────────────────────────────────────────

// If an event is received, event is logged in server console and sent to client through the WebSocket connection
app.post("/", (req, res) => {
  console.log("Post request received...");
  const headers = req.headers;
  const data = req.body;
  console.log(data);
  console.log("\n ...End of request...\n");

  // Update in-memory state for Q-SYS polling
  updateStateFromEvent(headers, data);

  sendRequest({ headers: headers, data: data });
  res.sendStatus(200);
});

app.get("/oauth", (req, res) => {
  const { state, code } = req.query;
  const redirectTo = `http://localhost:3000?state=${state}&code=${code}`;

  res.redirect(302, redirectTo);

  console.log(`Redirecting /oauth to ${redirectTo}`);
});

// If localhost:8000 is navigated to, Hello World is displayed
app.get("/", (req, res) => {
  console.log("GET request received...");
  res.send("Hello World");
});


// ─── Q-SYS Integration Endpoints ───────────────────────────────────────────────

/**
 * POST /api/config
 * Receives the OAuth token and groupId from the web client after the user selects a group.
 * This allows the server to make authenticated Sonos API calls on behalf of Q-SYS.
 * Body: { token: string, groupId: string }
 */
app.post("/api/config", (req, res) => {
  const { token, groupId } = req.body;
  if (!token || !groupId) {
    return res.status(400).json({ error: "token and groupId are required" });
  }
  sonosState.token = token;
  sonosState.groupId = groupId;
  console.log(`[Q-SYS Config] Stored token and groupId: ${groupId}`);
  res.json({ ok: true });
});

/**
 * GET /api/status
 * Returns the current playback state for Q-SYS to poll.
 * Response: { trackName, artistName, containerName, isPlaying, groupId }
 */
app.get("/api/status", (req, res) => {
  res.json({
    trackName: sonosState.trackName,
    artistName: sonosState.artistName,
    containerName: sonosState.containerName,
    isPlaying: sonosState.isPlaying,
    groupId: sonosState.groupId
  });
});

/**
 * POST /api/play
 * Sends a play command to Sonos. Called from Q-SYS.
 */
app.post("/api/play", async (req, res) => {
  try {
    await callSonosAPI("playback/play");
    sonosState.isPlaying = true;
    console.log("[Q-SYS] Play command sent");
    res.json({ ok: true });
  } catch (err) {
    console.error("[Q-SYS] Play error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pause
 * Sends a pause command to Sonos. Called from Q-SYS.
 */
app.post("/api/pause", async (req, res) => {
  try {
    await callSonosAPI("playback/pause");
    sonosState.isPlaying = false;
    console.log("[Q-SYS] Pause command sent");
    res.json({ ok: true });
  } catch (err) {
    console.error("[Q-SYS] Pause error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/toggle
 * Toggles play/pause. Called from Q-SYS.
 */
app.post("/api/toggle", async (req, res) => {
  try {
    await callSonosAPI("playback/togglePlayPause");
    sonosState.isPlaying = !sonosState.isPlaying;
    console.log("[Q-SYS] Toggle command sent");
    res.json({ ok: true, isPlaying: sonosState.isPlaying });
  } catch (err) {
    console.error("[Q-SYS] Toggle error:", err.message);
    res.status(500).json({ error: err.message });
  }
});
