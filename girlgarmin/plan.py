"""Picks which training plan the rest of the code uses.

If ``girlgarmin/plans/my_plan.py`` exists (git-ignored, so it never gets published), that plan
is used. Otherwise the example plan in ``girlgarmin/plans/example_plan.py`` is used.

To make your own private plan: copy example_plan.py to my_plan.py in the same folder and edit it.
"""

from importlib import import_module
from pathlib import Path

_PLANS = Path(__file__).parent / "plans"
_name = "my_plan" if (_PLANS / "my_plan.py").exists() else "example_plan"
P = import_module(f"girlgarmin.plans.{_name}")
