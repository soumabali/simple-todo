import json, urllib.request, urllib.error, http.cookiejar, sys
BASE="https://todo.nexigo.my.id"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
class NR(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*a,**k): return None
cj=http.cookiejar.CookieJar(); op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj), NR())
def req(m,p,b=None):
    h={"User-Agent":UA,"Origin":BASE,"Referer":BASE+"/login"}
    d=json.dumps(b).encode() if b is not None else None
    if b is not None: h["Content-Type"]="application/json"
    r=urllib.request.Request(BASE+p,data=d,headers=h,method=m)
    try: resp=op.open(r)
    except urllib.error.HTTPError as e: resp=e
    t=resp.read().decode()
    try: return resp.status,json.loads(t)
    except: return resp.status,{"_raw":t[:100]}
def ok(n,c,d=""): print(("PASS" if c else "FAIL"),n,("— "+str(d)) if d else "")

st,js=req("POST","/api/auth/sign-in/email",{"email":"e2e-admin@flowboard.test","password":"E2ePassw0rd!"})
ok("login",st==200,st)
st,js=req("POST","/api/boards",{"name":"U1 Label Test"})
bid=js.get("board",{}).get("id"); ok("create board 201",st==201,st)
st,js=req("GET",f"/api/boards/{bid}")
todo=[s for s in js["statuses"] if s["name"]=="To Do"][0]["id"]
st,js=req("POST",f"/api/boards/{bid}/labels",{"name":"bug","color":"rose"})
lid=js.get("label",{}).get("id"); ok("create label 201",st==201,st)
st,js=req("POST",f"/api/boards/{bid}/tasks",{"title":"Label task","statusId":todo})
tid=js.get("task",{}).get("id"); ok("create task 201",st==201,st)

st,js=req("POST",f"/api/tasks/{tid}/labels",{"labelId":lid})
ok("U1 attach label 201",st==201,f"{st} {js}")
st,js=req("POST",f"/api/tasks/{tid}/labels",{"labelId":lid})
ok("U1 attach idempotent 201",st==201,st)
st,js=req("GET",f"/api/tasks/{tid}/labels")
ok("U1 GET labels has it",st==200 and lid in js.get("labelIds",[]),js)
st,js=req("DELETE",f"/api/tasks/{tid}/labels",{"labelId":lid})
ok("U1 detach 200",st==200,st)
st,js=req("GET",f"/api/tasks/{tid}/labels")
ok("U1 GET labels empty",st==200 and lid not in js.get("labelIds",[]),js)

st,js=req("POST","/api/boards",{"name":"Other board"}); bid2=js["board"]["id"]
st,js=req("POST",f"/api/boards/{bid2}/labels",{"name":"other","color":"sky"}); lid2=js["label"]["id"]
st,js=req("POST",f"/api/tasks/{tid}/labels",{"labelId":lid2})
ok("U1 cross-board label -> 400",st==400,f"{st} {js.get('error',{}).get('message')}")

# board detail includes labels/taskLabels for the new UI
st,js=req("POST",f"/api/tasks/{tid}/labels",{"labelId":lid})
st,js=req("GET",f"/api/boards/{bid}")
ok("board payload has labels[] + taskLabels[]", "labels" in js and "taskLabels" in js, f"labels={len(js.get('labels',[]))} taskLabels={len(js.get('taskLabels',[]))}")

# U3: board PATCH name/desc/color + archive
st,js=req("PATCH",f"/api/boards/{bid}",{"name":"Renamed","description":"desc","color":"violet"})
ok("U3 board edit 200",st==200 and js.get("board",{}).get("color")=="violet",f"{st} color={js.get('board',{}).get('color')}")
st,js=req("PATCH",f"/api/boards/{bid}",{"isArchived":True})
ok("U3 board archive 200",st==200 and js.get("board",{}).get("isArchived")==True,st)

# U4: column rename/color
st,js=req("PATCH",f"/api/statuses/{todo}",{"name":"Backlog","color":"sky"})
ok("U4 column rename+color 200",st==200 and js.get("status",{}).get("name")=="Backlog",f"{st} {js.get('status',{}).get('name')}")
st,js=req("PATCH",f"/api/statuses/{todo}/move",{"position":500})
ok("U4 column move 200",st==200,st)

req("DELETE",f"/api/boards/{bid}"); req("DELETE",f"/api/boards/{bid2}")
print("cleanup done")
