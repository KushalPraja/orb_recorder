Todolist.md :

[important] clean up codebase:
- remove old unused code
- make functions more strict especially in the main process so that we dont do || everything should be fixed  or options / candidates should be avoided where possible and we should know exactly what type of data we are working with at all times
- add more comments and docstrings to functions and components
- make everything more unified between components (state management)
- try to get rid of states where not needed rather improve data flow
- get rid of unused variables, imports
- remove code that is not being used but was used before, example we now do the mp4 directly after the recording is done, so we do not need to keep the webm file around, and we dont need that step of remux to mp4 when we export 0 - 40 % since we always have an mp4 file ready to go. look at post processor for this. alot of code in there is not needed because of this.

- window recording will break since the zooms are based on the click position relative to the entire screen, so if we are only recording a window, the click position will be different and the zooms will be off, need to fix this by calculating the click position relative to the recorded window instead of the entire screen
- zooms in dual monitor setups as the click position is going out of bounds of the screen dimensions, need to fix this by making sure we are calculating the click position relative to the correct screen in multi monitor setups
-choose between windows or displays recording.
- the clicks are not that good since right now if we spam clicks it will trigger a zoom for each click, also its feels kinda jittery since we are zooming in and panning and zooming out and sometimes they are doing it at the same time.

-- restart should reset the recording and not just stop it, right now if we restart the recoridng it pushed u back to the select recording screen.

- main: speed up the processing time right now it is so slow because of the way we are doing the processing in opencv/ ffmpeg.


-- after these are fixed, we can deploy the first verson and make a basic html css website. 

        --color-primary: #e6e2d6;
        --color-accent
#e7a15a
: #e7a15a;
        --color-base: #e6e2d6;
        --color-light: #aaa;
        --color-border: #333;
        --color-bg: #0f1214;

- add option for audio recording (might not work on mac) 
- improve overlay to include pause and discard buttons or redo button
- add face cam option


