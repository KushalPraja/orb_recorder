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

[] improve post processing and add options for it:
    [] add options for trimming the video, this can be done by allowing the user to select a start and end time for the recording and then using ffmpeg to trim the video accordingly
    [] add options for adding text or annotations to the video, this can be done by allowing the user to select a portion of the video and then adding text or annotations to that portion using ffmpeg
    [] add options for changing the video format or quality, this can be done by allowing the user to select the desired format or quality and then using ffmpeg to convert the video accordingly

[] add support for recording audio along with the screen recording, this can be done by using electron's desktopCapturer to capture the audio along with the video and then using ffmpeg to combine them into a single video file

[] even though we have support to record other screens we shoudl fix the post processing to work correctly with recordings from other screens as well, this can be done by making sure that the correct screen dimensions and coordinates are used when processing the video with ffmpeg

[] add support for recording specific windows instead of the entire screen, this can be done by using electron's desktopCapturer to capture a specific window and then using ffmpeg to process the video accordingly