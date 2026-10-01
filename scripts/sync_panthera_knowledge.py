#!/usr/bin/env python3
import os, json, hashlib, urllib.request, urllib.error
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ENDPOINT=os.environ["PANTHERA_KNOWLEDGE_ENDPOINT"]
TOKEN=os.environ["PANTHERA_OIDC_TOKEN"]
REPO=os.environ["GITHUB_REPOSITORY"]
SHA=os.environ.get("GITHUB_SHA","main")
SCOPE=os.environ.get("PANTHERA_KNOWLEDGE_SCOPE","global_core")
MODULE=os.environ.get("PANTHERA_KNOWLEDGE_MODULE","PANTHERA RUNTIME")
PRIORITY=int(os.environ.get("PANTHERA_KNOWLEDGE_PRIORITY","75"))
TEXT_EXT={".md",".txt",".json",".yaml",".yml",".js",".mjs",".ts",".tsx",".jsx",".py",".sh",".zsh",".toml",".csv",".tsv",".html",".css",".sql"}
IGNORE={".git","node_modules",".venv","venv","__pycache__"}
MAX_FILE=700000

def chunks(s,max_chars=5200,overlap=500):
    s=s.replace("\r\n","\n")
    if len(s)<=max_chars:return [s]
    out=[];p=0
    while p<len(s):
        e=min(len(s),p+max_chars)
        if e<len(s):
            cut=max(s.rfind("\n\n",p,e),s.rfind("\n",p,e),s.rfind(". ",p,e))
            if cut>p+int(max_chars*.55):e=cut+1
        out.append(s[p:e])
        if e>=len(s):break
        p=max(p+1,e-overlap)
    return out

def post(payload):
    req=urllib.request.Request(ENDPOINT,data=json.dumps(payload,ensure_ascii=False).encode(),method="POST",
      headers={"Authorization":"Bearer "+TOKEN,"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=180) as r:return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8','replace')}")

rows=[];keys=[];docs=0
for p in sorted(ROOT.rglob("*")):
    if not p.is_file() or p.suffix.lower() not in TEXT_EXT:continue
    if any(x in IGNORE for x in p.parts):continue
    if p.stat().st_size>MAX_FILE:continue
    rel=p.relative_to(ROOT).as_posix()
    text=p.read_text(encoding="utf-8",errors="replace")
    if not text.strip():continue
    docs+=1
    key=f"github:{REPO}:{rel}";keys.append(key)
    version=hashlib.sha256(text.encode()).hexdigest()
    priority=PRIORITY
    module=MODULE
    if rel.startswith("docs/") or "KNOWLEDGE" in rel.upper():priority=min(100,PRIORITY+10)
    if "README" in rel.upper():priority=min(100,PRIORITY+5)
    for i,c in enumerate(chunks(text)):
        rows.append({"document_key":key,"title":p.name,
          "source_uri":f"https://github.com/{REPO}/blob/main/{rel}",
          "scope":SCOPE,"module":module,"priority":priority,"version":version,
          "chunk_index":i,"content":c,
          "metadata":{"repository":REPO,"path":rel,"commit_sha":SHA,"content_sha256":version,"size":p.stat().st_size,"sync_contract":"PANTHERA_GITHUB_KNOWLEDGE_SYNC_V1"}})

accepted=0
for i in range(0,len(rows),18):
    x=post({"action":"upsert","repository":REPO,"chunks":rows[i:i+18]})
    accepted+=int(x.get("accepted",0))
post({"action":"manifest","repository":REPO,"document_keys":keys})
print(json.dumps({"repository":REPO,"documents":docs,"chunks":len(rows),"accepted":accepted}))
