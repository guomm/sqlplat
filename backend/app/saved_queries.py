from fastapi import Depends, HTTPException, Query, Response
from sqlalchemy import func, or_, select

from .models import Connection, SavedQuery, utcnow
from .schemas import SavedQueryInput, SavedQueryName


def register_saved_queries(app, authenticated, db_dep):
    def owned(sid, user, db):
        item = db.get(SavedQuery, sid)
        if not item or item.user_id != user.id:
            raise HTTPException(404, "保存的 SQL 不存在，请使用另存为创建新记录")
        return item

    def public(item, db, full=True):
        connection = (
            db.get(Connection, item.connection_id) if item.connection_id else None
        )
        return {
            **{
                k: getattr(item, k)
                for k in (
                    "id",
                    "name",
                    "connection_id",
                    "database",
                    "created_at",
                    "updated_at",
                )
            },
            "sql": item.sql if full else item.sql[:500],
            "connection_id": connection.id
            if connection and not connection.deleted
            else None,
            "connection_name": (
                connection.name + "（已删除）"
                if connection and connection.deleted
                else connection.name
                if connection
                else "未指定连接"
            ),
        }

    def validate_connection(data, db):
        if data.connection_id is not None:
            # Match deletion's row lock and use a current read under MySQL
            # REPEATABLE READ, rather than authentication's older snapshot.
            connection = db.scalar(
                select(Connection)
                .where(Connection.id == data.connection_id)
                .with_for_update()
            )
            if not connection or connection.deleted:
                raise HTTPException(404, "连接不存在，请重新选择连接")

    @app.get("/api/saved-queries")
    def listing(
        q: str = Query("", max_length=1000),
        page: int = Query(1, ge=1),
        user=Depends(authenticated),
        db=Depends(db_dep),
    ):
        conditions = [SavedQuery.user_id == user.id]
        if q:
            conditions.append(
                or_(
                    SavedQuery.name.contains(q, autoescape=True),
                    SavedQuery.sql.contains(q, autoescape=True),
                )
            )
        total = db.scalar(
            select(func.count()).select_from(SavedQuery).where(*conditions)
        )
        items = db.scalars(
            select(SavedQuery)
            .where(*conditions)
            .order_by(SavedQuery.updated_at.desc(), SavedQuery.id.desc())
            .offset((page - 1) * 20)
            .limit(20)
        ).all()
        return {"items": [public(item, db, False) for item in items], "total": total}

    @app.post("/api/saved-queries", status_code=201)
    def create(data: SavedQueryInput, user=Depends(authenticated), db=Depends(db_dep)):
        validate_connection(data, db)
        item = SavedQuery(user_id=user.id, **data.model_dump())
        db.add(item)
        db.commit()
        return public(item, db)

    @app.get("/api/saved-queries/{sid}")
    def get(sid: str, user=Depends(authenticated), db=Depends(db_dep)):
        return public(owned(sid, user, db), db)

    @app.put("/api/saved-queries/{sid}")
    def update(
        sid: str, data: SavedQueryInput, user=Depends(authenticated), db=Depends(db_dep)
    ):
        item = owned(sid, user, db)
        validate_connection(data, db)
        for key, value in data.model_dump().items():
            setattr(item, key, value)
        item.updated_at = utcnow()
        db.commit()
        return public(item, db)

    @app.patch("/api/saved-queries/{sid}")
    def rename(
        sid: str, data: SavedQueryName, user=Depends(authenticated), db=Depends(db_dep)
    ):
        item = owned(sid, user, db)
        item.name = data.name
        item.updated_at = utcnow()
        db.commit()
        return public(item, db)

    @app.delete("/api/saved-queries/{sid}", status_code=204)
    def delete(sid: str, user=Depends(authenticated), db=Depends(db_dep)):
        db.delete(owned(sid, user, db))
        db.commit()
        return Response(status_code=204)
