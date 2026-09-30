# Topology Go: Baduk Beyond Flat Boards

A fully playable Go game on cylinders, tori, and Möbius strips—built during OpenAI Build Week with Codex and GPT-5.6.

**Live demo:**
https://topology-go.pystashell.workers.dev/

---

## The idea

Traditional Go is played on a flat rectangular board with clear edges and corners.

Topology Go begins with a different question:

> What would Go feel like on a board without traditional boundaries?

My original idea was to create Go on a sphere. While exploring the geometry, however, I discovered that a regular rectangular Go grid does not fit naturally on a sphere without distortion or irregular intersections.

That led to a more interesting direction: connecting the edges of a normal board in different ways.

The same rectangular grid can become:

- A **cylinder**, where the left and right edges connect
- A **torus**, where both pairs of opposite edges connect
- A **Möbius strip**, where one pair of edges connects with reversed orientation

These surfaces are not visual skins. Their topology changes adjacency, liberties, captures, territory, escape routes, connections, and strategy.

---

## What makes it different

Players make moves on a familiar flat Go board, but the board can be dragged continuously through its connected directions.

Visually, there is no final edge.

When stones disappear from one side, they reappear from the opposite side. On the torus, players can continue sliding horizontally or vertically and eventually return to the same position.

The logical board is finite, but its flat representation repeats continuously.

This creates strategic situations that cannot occur in ordinary Go:

- A fight on the left can connect directly to stones on the right
- Groups that appear distant may already support or surround one another
- A formation may attack through what appears to be the opposite side
- Players must think beyond the currently visible window

At any time, players can switch between the flat board and its synchronized 3D surface.

A complete game can also be replayed on the cylinder, torus, or Möbius strip, allowing players to see how a familiar two-dimensional battle unfolded inside a connected geometric space.

---

## Features

### Topology-aware Go

- Cylinder, torus, and Möbius-strip boards
- 9×9, 13×13, and 19×19 presets
- Custom board sizes from 5×5 to 25×25
- Seam-aware group connection and liberty counting
- Captures across connected edges
- Suicide prevention
- Positional superko
- Territory traversal and dead-stone marking
- Chinese area scoring and Japanese territory scoring
- Configurable komi

### Ways to play

- Local two-player mode
- Browser-based AI opponent
- Online multiplayer rooms
- Invitation links
- Spectator mode
- Reconnection and room-state recovery
- Negotiated undo for online games

### Replay and analysis

- Full move-by-move replay
- Timeline scrubbing
- Adjustable playback speed
- Import and export
- Switching between flat and 3D views during replay
- AI-assisted position analysis
- Candidate-move visualization
- Whole-game analysis
- AI markers synchronized across flat and 3D boards

### Communication

- Real-time online chat
- Unicode and emoji support
- Clickable board-coordinate references such as `D4` and `K10`
- Coordinate highlighting across all synchronized views

---

## How Codex and GPT-5.6 were used

This project was conceived and built during OpenAI Build Week through an intensive AI-assisted vibe-coding workflow.

My role was closer to that of a:

- Product designer
- Game-system designer
- Creative director
- Tester
- Player

I defined the central idea, researched the possible topologies, decided how each board should behave, designed the interaction model, tested every version, identified confusing or incorrect behavior, and continuously refined the product.

**Codex and ChatGPT generated and revised the implementation. I did not manually type the implementation code.**

### Product development with Codex

I usually began by describing the result I wanted rather than specifying every technical step.

For example, I would describe:

- How an endlessly pannable board should feel
- How stones should reappear after crossing a seam
- How a flat position should correspond to the 3D geometry
- How replay and AI analysis should remain synchronized
- How online players should interact with rooms and shared game state

I often allowed Codex to propose its own architecture and implementation approach first.

The model frequently produced solutions that surprised me. When an approach worked well, I could continue developing the product without prescribing the implementation myself. When it did not match the intended experience, I gave more precise feedback, examples, or constraints.

### Debugging with GPT-5.6 Sol

GPT-5.6 Sol was used throughout the project for:

- Feature implementation
- Topology-specific game behavior
- Debugging
- AI integration
- Interaction refinement
- Repeated product iteration

Debugging happened primarily through natural-language conversation.

Instead of opening the code and investigating every line myself, I described:

- What happened
- What I expected to happen
- Under what conditions the issue appeared
- What had changed before the issue occurred

The model investigated the likely cause, proposed a revision, and updated the implementation. I then tested the result and continued the conversation until the behavior matched the intended design.

Because I have programming experience, I could provide technical context and judge whether the diagnosis made sense. However, the workflow felt less like manually repairing a machine and more like a doctor interviewing a patient: observing symptoms, forming a diagnosis, applying a treatment, and checking whether the problem disappeared.

### Fast first, precise later

The development process followed a clear fast-then-slow pattern.

Early in the project, I gave the AI broad goals and freedom to explore. This produced a playable prototype very quickly.

Later, the work became increasingly detailed. Most of my time shifted toward:

- Human-computer interaction
- Camera behavior
- Board movement
- Stone placement
- Visual synchronization
- Replay controls
- AI visualization
- Product consistency
- UI refinement

At that stage, I repeatedly played the game and gave increasingly precise feedback.

Annotated screenshots also became useful as visual blueprints. Arrows, boxes, and short notes often communicated UI and interaction requirements more effectively than long written descriptions.

---

## AI opponent

A topology experiment is easy to demonstrate, but Go is only meaningful when there is someone—or something—worth playing against.

A player may open the game without another person available, so the AI opponent was essential rather than optional.

The game uses a browser-based **KataGo hybrid system**:

1. A KataGo neural network provides global policy suggestions
2. The project applies topology-aware legality checks
3. A custom search evaluates moves using the actual cylinder, torus, or Möbius adjacency rules

The available models are:

- **Fast b10** — approximately 10.6 MiB, with WebGPU, WebGL, and CPU support
- **Enhanced b18** — approximately 93.4 MiB, requiring WebGPU

Inference runs locally in the player's browser inside a Web Worker. No account or paid inference API is required.

Because ordinary KataGo networks were trained on standard flat Go boards, the project does not claim that their normal-board strength transfers perfectly to unusual topologies.

---

## Technology

- OpenAI Codex
- GPT-5.6 Sol
- JavaScript
- Three.js
- TensorFlow.js
- KataGo neural networks
- WebGPU
- WebGL
- Web Workers
- Vite
- Cloudflare Workers
- Cloudflare Durable Objects
- WebSockets

### Architecture

- **Three.js** renders the cylinder, torus, and Möbius-strip views
- **TensorFlow.js** runs KataGo network inference in the browser
- **WebGPU/WebGL** accelerate local neural-network inference
- **Web Workers** keep AI computation separate from the UI thread
- **Cloudflare Workers** serve the application and room APIs
- **Durable Objects** maintain authoritative multiplayer room state
- **WebSockets** provide real-time moves, chat, spectators, and reconnection
- **Vite** handles local development and production builds

---

## Local development

### Install dependencies

```bash
npm install
npm run dev
```
