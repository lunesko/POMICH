from flask import Blueprint, jsonify, request

from bot.telegram_bot import handle_update

bp = Blueprint('main', __name__)

@bp.get('/health')
def health():
    return jsonify({'status': 'ok'})

@bp.get('/orders')
def list_orders():
    return jsonify({'error': 'gone', 'message': 'Use FastAPI /api'}), 410

@bp.post('/orders')
def create_order():
    return jsonify({'error': 'gone', 'message': 'Use FastAPI /api'}), 410

@bp.post('/telegram/webhook')
def telegram_webhook():
    # Legacy Flask webhook kept for local MVP only; production uses FastAPI.
    data = request.get_json(silent=True) or {}
    result = handle_update(data)

    if not result.get('handled'):
        return jsonify({'ok': False, 'error': 'chat_id missing'}), 400

    return jsonify({'ok': True, 'result': result})
