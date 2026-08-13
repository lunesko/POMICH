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


def test_realtime_ws_and_sse_share_bus():
    realtime.reset_realtime_for_tests()
    channel = realtime.channel_for_order("order-ws")
    sse_queue = realtime.subscribe(channel)
    try:
        class FakeWs:
            sent: list[dict] = []

            async def send_json(self, data):
                self.sent.append(data)

        fake_ws = FakeWs()

        async def _run():
            pump_task = asyncio.create_task(realtime.pump_websocket(fake_ws, channel))
            await asyncio.sleep(0.05)
            realtime.publish(channel, "order.updated", {"id": "order-ws", "status": "assigned"})
            await asyncio.sleep(0.05)
            pump_task.cancel()
            try:
                await pump_task
            except asyncio.CancelledError:
                pass
            return fake_ws.sent

        sent = asyncio.run(_run())
        assert sent[0]["type"] == "connected"
        assert any(item.get("type") == "order.updated" for item in sent)

        async def _drain():
            while True:
                try:
                    sse_queue.get_nowait()
                except asyncio.QueueEmpty:
                    break

        asyncio.run(_drain())

        realtime.publish(channel, "order.accepted", {"id": "order-ws", "status": "accepted"})
        sse_message = asyncio.run(asyncio.wait_for(sse_queue.get(), timeout=1.0))
        assert sse_message["type"] == "order.accepted"
    finally:
        realtime.unsubscribe(channel, sse_queue)
        realtime.reset_realtime_for_tests()
