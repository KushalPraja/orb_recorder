# processor – modular video post-processing package
#
# Produces Screen-Studio-style polished recordings with smooth auto-zoom,
# background compositing, click highlights, and scroll panning.
#
# Modules:
#   camera      – critically-damped spring virtual camera
#   background  – canvas / wallpaper / gradient builder + rounded-corner masks
#   shadow      – drop-shadow that respects rounded corners
#   effects     – click ripple animation
#   events      – event loading, debouncing, coordinate mapping, interpolation
#   pipeline    – frame-by-frame processing loop & FFmpeg I/O

__version__ = "2.0.0"
