import os
from flask import Flask

from bot.fastapi_app import app as fastapi_app
from bot.routes import bp

app = Flask(__name__)
app.register_blueprint(bp)
app.config['JSON_SORT_KEYS'] = False

# Expose the FastAPI app for uvicorn and keep Flask compatibility for the current MVP flow.
app.extensions['fastapi_app'] = fastapi_app

if __name__ == '__main__':
    port = int(os.getenv('PORT', '5000'))
    app.run(host='0.0.0.0', port=port)
