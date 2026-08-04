"""convert scan_type to enum

Revision ID: f1a7c3e9b2d4
Revises: c4f2d6a9e1b3
Create Date: 2026-08-04 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a7c3e9b2d4'
down_revision: Union[str, Sequence[str], None] = 'c4f2d6a9e1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

scan_type_enum = sa.Enum('url', 'email', 'sms', 'image', 'qr', name='scan_type_enum')


def upgrade() -> None:
    """Upgrade schema."""
    scan_type_enum.create(op.get_bind())
    op.alter_column(
        'scans',
        'scan_type',
        existing_type=sa.String(length=20),
        type_=scan_type_enum,
        postgresql_using='scan_type::scan_type_enum',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column(
        'scans',
        'scan_type',
        existing_type=scan_type_enum,
        type_=sa.String(length=20),
        postgresql_using='scan_type::text',
    )
    scan_type_enum.drop(op.get_bind())
