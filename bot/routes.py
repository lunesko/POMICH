from flask import Blueprint, jsonify

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
    return jsonify({'error': 'gone', 'message': 'Use FastAPI telegram webhook'}), 410
