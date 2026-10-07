import asyncio

from bot import realtime


def test_realtime_publish_reaches_subscriber():
    async def run():
        channel = realtime.channel_for_order("order-1")
        queue = realtime.subscribe(channel)
        try:
            realtime.publish_order_event({"id": "order-1", "status": "accepted", "customerId": "c1"}, "order.accepted")
            message = await asyncio.wait_for(queue.get(), timeout=1.0)
            assert message["type"] == "order.accepted"
            assert message["payload"]["id"] == "order-1"
            assert message["payload"]["status"] == "accepted"
        finally:
            realtime.unsubscribe(channel, queue)
    asyncio.run(run())


def test_realtime_provider_channel_helpers():
    assert realtime.channel_for_provider("p1") == "provider:p1"
    assert realtime.channel_for_customer("c1") == "customer:c1"


def test_realtime_ws_and_sse_share_bus():
    async def run():
        channel = realtime.channel_for_order("order-ws")
        queue = realtime.subscribe(channel)
        connected = asyncio.Event()
        delivered = asyncio.Event()

        class FakeWs:
            def __init__(self):
                self.sent = []

            async def send_json(self, data):
                self.sent.append(data)
                if data["type"] == "connected":
                    connected.set()
                if data["type"] == "order.updated":
                    delivered.set()

        ws = FakeWs()
        task = asyncio.create_task(realtime.pump_websocket(ws, channel))
        try:
            await asyncio.wait_for(connected.wait(), 1)
            realtime.publish(channel, "order.updated", {"id": "order-ws"})
            message = await asyncio.wait_for(queue.get(), 1)
            await asyncio.wait_for(delivered.wait(), 1)
            assert message["type"] == "order.updated"
            assert ws.sent[0]["type"] == "connected"
        finally:
            task.cancel()
            await task
            realtime.unsubscribe(channel, queue)
    asyncio.run(run())


def test_pump_websocket_unsubscribes_on_send_failure():
    """Broken pipe / RuntimeError must not leave a dead-cat queue subscriber."""
    realtime.reset_realtime_for_tests()
    channel = realtime.channel_for_order("order-dead")

    class DyingWs:
        async def send_json(self, data):
            if data.get("type") == "connected":
                return
            raise RuntimeError("Connection closed")

    async def _run():
        task = asyncio.create_task(realtime.pump_websocket(DyingWs(), channel, heartbeat_seconds=0.05))
        await asyncio.sleep(0.12)
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        with realtime._LOCK:
            listeners = list(realtime._CHANNELS.get(channel, []))
        return listeners

    listeners = asyncio.run(_run())
    assert listeners == []
    realtime.reset_realtime_for_tests()


def test_publish_from_thread_wakes_waiting_consumer():
    async def run():
        channel = "order:thread"
        queue = realtime.subscribe(channel)
        try:
            consumer = asyncio.create_task(queue.get())
            await asyncio.sleep(0)
            await asyncio.to_thread(realtime.publish, channel, "order.updated", {"id": "thread"})
            message = await asyncio.wait_for(consumer, 1)
            assert message["payload"] == {"id": "thread"}
        finally:
            realtime.unsubscribe(channel, queue)
    asyncio.run(run(), debug=True)


def test_full_queue_keeps_latest_events():
    async def run():
        channel = "order:full"
        queue = realtime.subscribe(channel, maxsize=2)
        try:
            await asyncio.to_thread(lambda: [realtime.publish(channel, "update", {"n": n}) for n in range(5)])
            await asyncio.sleep(0)
            assert queue.qsize() == 2
            assert [queue.get_nowait()["payload"]["n"] for _ in range(2)] == [3, 4]
        finally:
            realtime.unsubscribe(channel, queue)
    asyncio.run(run(), debug=True)


def test_publish_removes_subscriber_with_closed_loop():
    channel = "order:closed"
    async def register():
        return realtime.subscribe(channel)
    asyncio.run(register())
    realtime.publish(channel, "update")
    assert channel not in realtime._CHANNELS
