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
- choose between windows or displays recording add options for both and make sure the zooms work correctly in both cases
