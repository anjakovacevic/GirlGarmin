"""Where things live on disk. Every module takes its paths from here."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # the repo folder
DATA = ROOT / "data"                            # your downloaded Garmin data (git-ignored)
RAW = DATA / "raw"                              # untouched JSON from Garmin
# Login tokens written by girlgarmin.login - in your home folder, outside the repo on purpose.
TOKENSTORE = Path("~/.garminconnect").expanduser()
