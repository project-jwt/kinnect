# db/migrations.py — hand-rolled, idempotent schema migrations run at startup.
#
# There's no Alembic yet. create_all (in main.py's lifespan) only CREATEs
# missing tables — it never ALTERs an existing one — so schema changes to a
# table that's already in a deployed database live here and run once per boot,
# inside the same create_all transaction.
#
# Rules for anything added here:
#   - IDEMPOTENT: safe to run on every restart (guard on current state).
#   - Postgres-only: SQLite is the test DB, where create_all already builds the
#     current schema, so each migration early-returns on other dialects.
# This is a stopgap; once there's more than one, switch to Alembic.

from sqlalchemy import Connection, text


async def run_startup_migrations(async_conn) -> None:
    """Apply migrations create_all can't. Runs on a sync Connection (via
    run_sync) so dialect detection and DDL use the stable sync API."""
    await async_conn.run_sync(_migrate)


def _migrate(conn: Connection) -> None:
    if conn.dialect.name != "postgresql":
        return  # SQLite (local/CI tests): create_all already made the right schema
    _summary_recipients_contact_id_set_null(conn)
    _contact_invites_add_cancelled_at(conn)
    _contact_invites_index_email(conn)


def _summary_recipients_contact_id_set_null(conn: Connection) -> None:
    """summary_recipients.contact_id: ON DELETE CASCADE -> SET NULL (and drop
    NOT NULL), so a delivery receipt SURVIVES the recipient deleting their
    account (contact_id becomes NULL = "sent to a deleted user") instead of
    being cascaded away.

    Guarded on the FK's current delete rule, so it runs exactly once:
    confdeltype 'c' = cascade (old — migrate); 'n' = set null (done — skip);
    no row = a fresh DB where create_all already built it as SET NULL (skip).
    """
    rule = conn.execute(
        text(
            "SELECT confdeltype FROM pg_constraint "
            "WHERE conname = 'summary_recipients_contact_id_fkey'"
        )
    ).scalar()
    # confdeltype is Postgres's internal "char" type; asyncpg hands it back as
    # bytes (b'c'), psql shows it as text ('c') — normalize before comparing.
    if isinstance(rule, (bytes, bytearray)):
        rule = rule.decode()
    if rule != "c":
        return

    conn.execute(text("ALTER TABLE summary_recipients ALTER COLUMN contact_id DROP NOT NULL"))
    conn.execute(text("ALTER TABLE summary_recipients DROP CONSTRAINT summary_recipients_contact_id_fkey"))
    conn.execute(
        text(
            "ALTER TABLE summary_recipients "
            "ADD CONSTRAINT summary_recipients_contact_id_fkey "
            "FOREIGN KEY (contact_id) REFERENCES users(user_id) ON DELETE SET NULL"
        )
    )


def _contact_invites_add_cancelled_at(conn: Connection) -> None:
    """contact_invites.cancelled_at: the soft-delete stamp that makes cancelling
    an invitation stop refunding the 24h send cap (models/invite_model.py).

    The TABLE is new on this branch, so create_all builds it — but a database
    that already booted an earlier commit of the branch has the table WITHOUT
    this column, and create_all never ALTERs. Hence this entry.

    Guarded on the column's existence, so it runs at most once: present = done
    (either a previous boot ran this, or create_all just built the table with
    it), absent = the older shape, add it. Nullable with no default, so the ADD
    is a catalog-only change — no table rewrite, no lock held while rows are
    touched.
    """
    already = conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'contact_invites' AND column_name = 'cancelled_at'"
        )
    ).scalar()
    if already:
        return

    conn.execute(text("ALTER TABLE contact_invites ADD COLUMN cancelled_at TIMESTAMPTZ"))


def _contact_invites_index_email(conn: Connection) -> None:
    """contact_invites.email: add the standalone index create_all would have
    made on a fresh DB, for databases where the table already exists.

    The table's UNIQUE (owner_id, email) leads with owner_id, so it can't serve
    a lookup by email alone — which is what accept_for_user does on EVERY
    registration (list_pending_for_email). Without this, that lookup is a
    sequential scan of the whole table.

    No state guard needed: CREATE INDEX IF NOT EXISTS is idempotent in
    Postgres, unlike the ALTERs above. The name must match the one SQLAlchemy
    derives from index=True (ix_<table>_<column>), or a fresh DB and a migrated
    one would end up with two indexes covering the same column.
    """
    conn.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_contact_invites_email "
            "ON contact_invites (email)"
        )
    )
