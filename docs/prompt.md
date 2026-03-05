I'm looking to create a desktop app using Electron (primarily for Linux, with plans to expand to Windows and macOS later) called ScreenArc - a screen recorder and editing studio similar to Screen Studio. The features should include:

- High-quality screen recording (up to 2K): allowing selection of custom areas, window, or full screen.

- Automatic cursor tracking and auto-zoom (zooming in on the cursor and click area).

- Powerful editing capabilities: editing can be divided into groups as follows:

- a) Frames of the original video placed within a parent frame. - The parent frame can be adjusted to: change the aspect ratio (16:9, 9:16, 4:3, 3:4, 1:1), change the background image (of the parent frame), change the padding (space between the original video frame and the parent frame), change the radius of the corner circle/shadow/border style of the original video frame, and other customization options.

- b) Video editing includes: customizable auto zoom, video trimming (more details will be provided later).

- Video output: output type (mp4, gif), fps, resolution (HD, 1080p, 2K), quality.


Here's a brief description of the user flow after selected new recording according to my opinion (based on ScreenStudio):

- The user selects the mode and settings, then presses record.

- The bar disappears, an icon appears in the tray, and a countdown screen is displayed.

- Recording begins, monitoring the mouse cursor position and click location.

- The user clicks the icon in the tray and stops recording.

- Opens Edit Studio.

- The user can edit the video as desired (background image/color/uploaded image/gradient, padding, border radius, or cut video segments/add, edit, delete, zoom).

- Press export video.

- Export video and finish.

Brief overview of the editing interface:

- Title bar: From left to right, it includes traffic lights -> ScreenArc -> Export button.

- The main area consists of a large preview area on the left and a toolbar below, and a side panel on the right (background, padding, roundeness, etc.). The toolbar includes a control bar (dropdown for selecting aspect ratio, three buttons: prev, play/pause, next, add cut track button, add zoom track button, and sliders for zooming in/out of tracks).

- The video and track editing area includes a timeline, original video track, and a second track to display segments (rounded rectangle) for zooming and cutting.

**MOUSE TRACKING + AUTO ZOOM FEATURE (core, extremely important feature)**:

When the user clicks on a location (for example, clicking a button), the system should automatically zoom to that location. Let's call the click time x and the zoom level Z. We can divide this into three stages: 1) starting the zoom from time x - T to x (zooming from 1x to Zx), 2) mouse tracking stage, the frame is still zoomed and moves with the mouse movement, 3) zooming out in the opposite direction of step 1.

Note:

- Easing is required (user optional) for a smooth effect.

- These actions apply to the parent frame (after applying the original video frame with background, rounded corners, padding, aspect ratio, etc.).

**ZOOM EDITING AND CUTTING FEATURE**

- Each auto zoom will create a rounded rectangle (with default duration) on the second track (below the original video track).

- Users can manually add, edit, and delete zooms. When you click the "Add Zoom" button, it adds a zoom to the current position of the time marker with default settings, and changes the side panel to a screen displaying the zoom settings.

- Users can also add, edit, and delete cut segments (to mark those segments as cut) similarly.

- These zoom and cut segments support dragging along the horizontal axis of the track; you can drag at both ends to change the duration.

- Note that if you click the zoom in/out button on the toolbar, you need to zoom in/out on the timeline and both tracks accordingly.

OK. Please help me write the following documents in English:

- high-level-goals.md: a general description of the requirements

- tech-stacks.md: electron + typescript + tailwindcss + vite + zustand + WebRTC + MediaRecorder API for screen recording + fluent-ffmpeg (a library for video processing? Or if not necessary, can you recommend one for me?), pynput (a Python library for tracking mouse cursor position; I haven't found any reliable and well-maintained libraries for Node.js), etc.

- plan.md: a phased development plan

- user-flow.md: details of user activity flows (user actions, how the UI reacts, how the state changes, background tasks, etc.)