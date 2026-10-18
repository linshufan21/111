import requests
B="http://127.0.0.1:8787/api"
s=requests.Session()
r=s.post(B+"/auth/login", json={"identifier":"admin","password":"admin1234"})
print("login", r.status_code, r.json()["user"].get("role"), r.json()["user"].get("status"))
print("stats", s.get(B+"/admin/stats").status_code, s.get(B+"/admin/stats").json()["stats"])
qs=s.get(B+"/admin/questions?limit=2").json()
print("questions", qs["total"], [q["title"] for q in qs["items"]])
us=s.get(B+"/admin/users").json()
print("users", len(us["items"]), [(u["username"],u["role"],u["status"]) for u in us["items"][:3]])
q=qs["items"][0]
r=s.patch(B+f"/admin/questions/{q['id']}", json={"featured": not q["featured"]})
print("patch", r.status_code, r.json()["question"]["featured"])
s.patch(B+f"/admin/questions/{q['id']}", json={"featured": q["featured"]})
u=[x for x in us["items"] if x["username"]!="admin" and x["status"]=="active"][0]
r=s.patch(B+f"/admin/users/{u['id']}", json={"status":"banned"})
print("ban", r.status_code, r.json()["user"]["status"])
r=s.patch(B+f"/admin/users/{u['id']}", json={"status":"active"})
print("unban", r.status_code, r.json()["user"]["status"])
