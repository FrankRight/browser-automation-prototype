"""The workflows the run server offers. Importing this package registers them."""
from . import create_secret

INPUT_CHECKS = {"create_secret": create_secret.check_input}
