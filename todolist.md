Stuff That needs to me implemented:

[x] rewrite the whole main user interface:
[x] the main page should just show previous recordings and and show the record new button
[x] when record is pressed you should be taken to a new page where you can select the screen and start recording, maybe if you want to get fancy you can also show a preview of the recording in that page before starting the recording
[x] we should add settings where you can change the output directory, recording quality, and other settings related to the recording process this will stay persistent across sessions and be stored in a config file
[x] when recording is in progress there should be a stop button and a timer showing the duration of the recording as an overlay on the screen
[x] after recording is stopped the user should be taken to a new page where they can preview the recording and either save it or discard it

    we should use a frontend framework like react or vue for this and we can use electron's ipc to communicate between the frontend and the backend

    design language:
        - clean and minimalistic design with a focus on usability
        - examples that I like zed or vercel font should be inter or lyth mono
        - color scheme should be dark with accent colors for buttons and highlights
        - examples of good design can be found in apps like obsidian, zed, and vercel's dashboard
        - modern and sleek design with close to no animations to keep it fast and responsive
        - focus on devs as the target audience so we should have a design that appeals to developers and is easy to use for them

refactor code base to have 1 source of truth for all of the recording logic and post processing logic, this will make it easier to maintain and add new features in the future. Stuff like fps, resolution, and other recording settings should be stored in a config file and used throughout the codebase to ensure consistency and make it easier to change these settings in the future without having to search through the codebase for all the places where they are used.

[] do not use or statements to check for multiple conditions - instead mantain one source of truth and if it fails then it fails, this will make the code easier to read and maintain in the long run
