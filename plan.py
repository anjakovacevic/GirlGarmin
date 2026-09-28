"""Picks which training plan the other scripts use.

If you have a private ``my_program.py`` next to this file (git-ignored, so it never gets
published), that plan is used. Otherwise the example plan in ``program.py`` is used.

To make your own private plan:  copy program.py to my_program.py and edit the copy.
"""

try:
    import my_program as P  # noqa: F401  (your private plan)
except ModuleNotFoundError:
    import program as P  # noqa: F401  (the example plan shipped with the repo)
