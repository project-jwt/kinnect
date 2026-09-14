# Import every model module here so a single `import models` registers ALL
# tables in Base.metadata (main.py's create_all relies on this).
#
# ADDING A MODEL? Add its import below or create_all will silently skip its
# table — "why is my table missing" is almost always a missing import here.

from models import (  # noqa: F401
    contact_model,
    helpline_model,
    invite_model,
    summary_model,
    user_model,
)
