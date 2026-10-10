"""Explicit release-time migrations. Runtime workers never need DDL privileges."""
import os


def main():
    previous = os.environ.get("POMICH_AUTO_MIGRATE")
    os.environ["POMICH_AUTO_MIGRATE"] = "0"
    try:
        from bot import runtime_store, session_registry, realtime_auth  # register all tables
        engine = runtime_store.get_engine()
        with engine.connect() as connection:
            postgres = engine.dialect.name == "postgresql"
            if postgres:
                connection.exec_driver_sql("SELECT pg_advisory_lock(764209101)")
            try:
                runtime_store._install_schema(engine)
            finally:
                if postgres:
                    connection.exec_driver_sql("SELECT pg_advisory_unlock(764209101)")
    finally:
        if previous is None:
            os.environ.pop("POMICH_AUTO_MIGRATE", None)
        else:
            os.environ["POMICH_AUTO_MIGRATE"] = previous



if __name__ == "__main__":
    main()
