"""An unresolved case remains reachable beyond the first 200 reports."""
from bot import support_store, runtime_store
from bot.order_store import _write_json_atomic
from tests.test_business_logic import business_store


def test_old_unresolved_cases_remain_accessible_with_pagination(business_store):
    rows = [dict(id=f'SUP-{index:04}', orderId=f'order-{index}', customerId='synthetic', reason='other',
                 description='Synthetic report', status='open' if index < 251 else 'resolved',
                 createdAt=f'2026-10-26T12:{index // 60:02}:{index % 60:02}Z') for index in range(501)]
    if business_store == 'sql':
        with runtime_store.get_engine().begin() as connection:
            connection.execute(support_store.cases.insert(), [dict(id=row['id'], order_id=row['orderId'],
                customer_id=row['customerId'], status=row['status'], created_at=row['createdAt'], payload=row) for row in rows])
    else:
        _write_json_atomic(support_store._path(), rows)
    pages = [support_store.list_cases(status='unresolved', offset=offset, limit=100) for offset in (0, 100, 200)]
    assert [len(page) for page in pages] == [100, 100, 51]
    assert len({row['id'] for page in pages for row in page}) == 251
    assert pages[-1][-1]['id'] == 'SUP-0000'
    assert support_store.list_cases(order_id='order-0')[0]['id'] == 'SUP-0000'
