from flask import Blueprint, jsonify, request

from bot.order_store import load_orders, save_order
from bot.telegram_bot import handle_update, notify_order_created

bp = Blueprint('main', __name__)

@bp.get('/health')
def health():
    return jsonify({'status': 'ok'})

@bp.get('/orders')
def list_orders():
    return jsonify(load_orders())

@bp.post('/orders')
def create_order():
    payload = request.get_json(silent=True) or {}
    order = save_order(payload)

    if payload.get('notify') and payload.get('chatId'):
        notify_order_created(str(payload.get('chatId')), order)

    return jsonify(order), 201

@bp.post('/telegram/webhook')
def telegram_webhook():
    data = request.get_json(silent=True) or {}
    result = handle_update(data)

    if not result.get('handled'):
        return jsonify({'ok': False, 'error': 'chat_id missing'}), 400

    return jsonify({'ok': True, 'result': result})
