import asyncio

from bot import realtime


def test_realtime_publish_reaches_subscriber():
    realtime.reset_realtime_for_tests()
    channel = realtime.channel_for_order("order-1")
    queue = realtime.subscribe(channel)
    try:
        realtime.publish_order_event({"id": "order-1", "status": "accepted", "customerId": "c1"}, "order.accepted")

        async def _read():
            return await asyncio.wait_for(queue.get(), timeout=1.0)

        message = asyncio.run(_read())
        assert message["type"] == "order.accepted"
        assert message["payload"]["id"] == "order-1"
        assert message["payload"]["status"] == "accepted"
    finally:
        realtime.unsubscribe(channel, queue)
        realtime.reset_realtime_for_tests()


def test_realtime_provider_channel_helpers():
    assert realtime.channel_for_provider("p1") == "provider:p1"
    assert realtime.channel_for_customer("c1") == "customer:c1"
