"""GirlGarmin: download your Garmin Connect data and turn it into a training / cycle dashboard.

Modules (run the scripts from the repo folder with ``python -m girlgarmin.<name>``):
    login     one-time Garmin login, saves a token outside the repo
    sync      download new Garmin data into ./data and build the CSV tables
    workouts  upload / schedule / delete the training plan on Garmin Connect
    analysis  calculations and predictions used by the dashboard (app/dashboard.py)
    plan      picks the active training plan from girlgarmin/plans/
    paths     where data and login tokens live
"""
