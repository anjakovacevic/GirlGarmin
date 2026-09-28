"""One-time Garmin Connect login. Saves reusable tokens to ~/.garminconnect.

    python garmin_login.py

Asks for your Garmin email, password (hidden while typing) and, if you use two-step
verification, the code Garmin sends you. Only the resulting login *tokens* are saved, in the
``.garminconnect`` folder in your user home directory (C:\\Users\\<you>\\.garminconnect on
Windows, ~/.garminconnect on macOS/Linux) - outside this project, so they can never end up on
GitHub. Your password is not stored anywhere.

Run it again whenever a sync says the login expired (tokens last for months).
"""

import getpass
import sys
from pathlib import Path

from garminconnect import Garmin

TOKENSTORE = Path("~/.garminconnect").expanduser()


def main() -> None:
    email = input("Garmin email: ").strip()
    password = getpass.getpass("Garmin password (hidden): ")
    api = Garmin(email, password, prompt_mfa=lambda: input("MFA code: ").strip())
    TOKENSTORE.mkdir(parents=True, exist_ok=True)
    api.login(str(TOKENSTORE))
    api.client.dump(str(TOKENSTORE))
    print(f"Logged in as {api.get_full_name()}. Tokens saved to {TOKENSTORE}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.exit(f"Login failed: {e}")
