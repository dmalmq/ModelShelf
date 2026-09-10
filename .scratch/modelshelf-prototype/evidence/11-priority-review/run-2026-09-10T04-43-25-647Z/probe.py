import sqlite3
db = sqlite3.connect("/tmp/modelshelf-verify-ui-findings-dbB0Dr/modelshelf.db")
finding_id = "3932a09e-0a1c-4172-8418-69fe528e190a"
row = db.execute("SELECT model_id FROM finding_objects WHERE finding_id = ? LIMIT 1", (finding_id,)).fetchone()
model_id = row[0]
db.execute("INSERT INTO finding_objects (finding_id, model_id, object_id, express_id, global_id, actual) SELECT finding_id, model_id, object_id, express_id, global_id, actual FROM finding_objects WHERE finding_id = ? LIMIT 1", (finding_id,))
db.execute("INSERT INTO finding_objects (finding_id, model_id, object_id, express_id) VALUES (?, ?, NULL, -7)", (finding_id, model_id))
db.commit()
print("total", db.execute("SELECT COUNT(*) FROM finding_objects WHERE finding_id = ?", (finding_id,)).fetchone()[0])
