# Fitness Hub — Spec Sheet

Oct 18, 2026 · @Ittyy-Winter

## Overview

Fitness Hub รวมข้อมูลเวท (openGym), การวิ่งและสุขภาพ (Google Health API) และอาหารไว้ใน DB เดียว แล้วใช้ Claude Chat ผ่าน MCP เป็น AI ทั้งหมด จึงไม่ต้องจ่ายค่า LLM API เพิ่ม

**ปัญหา:** ตอนนี้ข้อมูลกระจายอยู่ 3 ที่ (Hevy, Google Health, แคลที่ไม่มีที่จด) และต้องเปิดหลายแอปถึงจะเห็นภาพรวม อีกทั้ง Hevy แบบฟรีไม่มี API ให้ดึงข้อมูลไปรวม

**เป้าหมาย**

- ใช้ openGym ที่ self-host แทน Hevy โดยเริ่มบันทึกใหม่ ไม่ย้ายประวัติ
- ดึงข้อมูล Pixel Watch 3 (วิ่ง, HR, sleep, HRV, แคลออก) เข้า hub อัตโนมัติทุกวัน
- Log อาหารด้วยการส่งรูปให้ Claude ประเมินแคลและ macro
- Claude วิเคราะห์ประจำวันอัตโนมัติ แล้วเขียนผลลง DB
- Dashboard เดียวบน Pixel 9 ที่แสดงข้อมูลและผลวิเคราะห์ล่าสุด

**ไม่ทำ (non-goals)**

- Real time: ข้อมูลอัปเดตวันละครั้งถึงไม่กี่ครั้งก็พอ
- เรียก LLM API แบบจ่ายตาม token, ใช้ AI coach ในตัว openGym
- รองรับหลายผู้ใช้หรือเปิดเป็น public service
- Fork หรือแก้โค้ด openGym

**วัดผลสำเร็จ**

- เลิกใช้ Hevy แล้วบันทึกเวทใน openGym ครบทุก session
- เปิด dashboard หลัง 09:00 แล้วเห็นผลวิเคราะห์ของเมื่อวานทุกวัน
- Log อาหารหนึ่งมื้อใช้เวลาไม่เกิน 30 วินาที (ถ่ายรูป + ส่งให้ Claude)
- ค่าใช้จ่ายเพิ่มจาก subscription Claude ที่มีอยู่ มีแค่ค่า domain กับค่าไฟ

## Users & devices

ผู้ใช้มีคนเดียวคือนาย อุปกรณ์ทั้งหมดอยู่ใน ecosystem ของ Google ฝั่ง health จึงดึงจาก Google Health API ได้ตรงๆ

| ส่วน | ใช้อะไร | บทบาท |
| --- | --- | --- |
| นาฬิกา | Pixel Watch 3 | บันทึกการวิ่ง, HR, HRV, sleep, VO2 max, แคลออก แล้ว sync ผ่านแอป Google Health |
| มือถือ | Pixel 9 | ใช้ openGym PWA ระหว่างเล่นเวท, ใช้ Claude app ส่งรูปอาหาร, ดู dashboard PWA |
| AI | Claude subscription (claude.ai) | วิเคราะห์ทั้งหมดผ่าน custom connector (remote MCP) และ scheduled task |
| Server | Laptop เครื่องเก่าที่หอ | รัน openGym, hub, MCP, dashboard ด้วย Docker Compose และออกเน็ตผ่าน Cloudflare Tunnel |

**ข้อจำกัด**

- ห้ามใช้ LLM API แบบจ่ายตาม token: งาน AI ทุกอย่างต้องผ่าน Claude Chat หรือ scheduled task เท่านั้น
- openGym ต้องใช้แบบ self-host + PWA ไม่ใช้ APK standalone เพราะ APK เก็บข้อมูลไว้บนเครื่อง hub ดึงไม่ได้
- งาน AI ใช้โควตา subscription ร่วมกับการใช้งานอื่น จึงต้องส่งข้อมูลให้ Claude แบบสรุปแล้ว ไม่ส่ง raw data

## System architecture

ทุก service อยู่บน laptop เก่าเครื่องเดียว และมี Postgres เป็นแหล่งข้อมูลกลาง Claude ไม่เคยเรียก Google Health หรือ openGym ตรงๆ แต่อ่านและเขียนผ่าน MCP เท่านั้น

&#91;embedded content: architecture · sources, laptop server services, Claude\]

ข้อมูลไหลจากซ้ายไปขวา: นาฬิกาและมือถือเป็นต้นทาง, sync worker รวมข้อมูลเข้า Postgres ทุกคืน จากนั้น dashboard อ่านผ่าน Hub API ส่วน Claude อ่านและเขียนผลวิเคราะห์ผ่าน MCP

| Service | Stack | Expose |
| --- | --- | --- |
| openGym (api + web) | Image ทางการ, pin version (เริ่มที่ 1.4.1) | `gym.<domain>` หลัง passkey |
| Sync worker | Node/TS หรือ Python + cron · รับงานจากคิว `sync_log` | ไม่ expose |
| Postgres | Postgres 16 | ไม่ expose |
| Hub API + Dashboard | Node/TS (Hono หรือ Fastify) + React PWA | `fit.<domain>` หลัง passkey หรือ Cloudflare Access |
| Remote MCP | MCP TypeScript SDK, Streamable HTTP | `mcp.<domain>` + auth (รวม `/upload/*` สำหรับรูปอาหาร) |
| Ingress | Cloudflare Tunnel (ไม่ต้องเปิด port หรือมี public IP ซึ่งเน็ตหอไม่มีให้) | HTTPS ทั้งหมด |

## Data sources & integration

ข้อมูลเข้า hub ได้ 3 ทาง: sync จาก Google Health ทุกคืน, sync จาก openGym ทุกคืนหรือหลังเล่นเสร็จ และอาหารที่ Claude เขียนเข้ามาผ่าน MCP

| Source | วิธีดึง | Data ที่ใช้ | ความถี่ |
| --- | --- | --- | --- |
| [Google Health API](https://developers.google.com/health) | REST + OAuth 2.0 (scope `activity_and_fitness`, `health_metrics_and_measurements`, `sleep`, `nutrition`) | exercise, distance, heart-rate, time-in-heart-rate-zone, steps, total-calories, active-energy-burned, sleep, daily-heart-rate-variability, daily-resting-heart-rate, daily-vo2-max, run-vo2-max, weight | cron ทุกคืน 21:00 + ปุ่ม sync เอง |
| [openGym API](https://github.com/DuarteSantos8/openGym) | HTTP API ตาม `api/openapi.yaml` · auth ด้วย bearer token จากการ pair (`POST /api/pair/create` → `/api/pair/redeem`) ซึ่งต่ออายุเองผ่าน `GET /api/me` · openGym เก็บข้อมูลเป็น JSON ทั้งก้อนต่อ profile จึงดึงด้วย `GET /api/data` และใช้ `GET /api/data/rev` เช็กก่อนว่ามีอะไรเปลี่ยนไหม · เรียกผ่าน Docker network ตรงๆ ไม่ผ่าน tunnel | workouts, sets, PR, routines (ไม่ใช้ body weight ของ openGym เพราะใช้น้ำหนักจาก Google Health) | cron ทุกคืน + webhook/ปุ่มหลังเล่น |
| อาหาร | Claude เรียก MCP tool `log_meal` | ชื่อเมนู, แคล, P/C/F, ความมั่นใจ, รูป | ทุกมื้อที่ส่งรูป |

**Google Health: สิ่งที่ต้องออกแบบรองรับ**

- ข้อมูลจะเข้า API หลังแอป Google Health sync (ประมาณทุก 15 นาทีถ้าแอปเปิดอยู่) cron จึงควร re-sync ย้อนหลัง 2 วันทุกครั้ง
- Rollup ของ heart-rate และ total-calories ดึงได้ทีละไม่เกิน 14 วัน ตัวอื่นไม่เกิน 90 วัน ส่วน exercise และ sleep ได้หน้าละ 25 session ต้องวน `nextPageToken`
- ใช้ `dailyRollUp` สำหรับตัวเลขรายวัน เพื่อให้ตัดวันตามเวลาไทย
- Backfill ครั้งแรก: ดึง 14 วันล่าสุดก่อน แล้วค่อยไล่ย้อนหลังเป็นก้อนละ 90 วัน
- เก็บ access/refresh token แบบเข้ารหัสใน DB และมี endpoint `/auth/google` สำหรับ re-consent เมื่อ token หมดอายุ

**openGym: เริ่มบันทึกใหม่**

- เริ่มบันทึกใหม่ใน openGym ไม่ import ประวัติจาก Hevy
- หลังจากนั้น hub อ่านจาก openGym อย่างเดียว ไม่เขียนกลับ

**Sync job: ทุกทางที่สั่ง sync ใช้คิวเดียวกัน**

Cron, ปุ่ม Sync now บน dashboard และ MCP `trigger_sync` ไม่ได้รัน sync เอง แต่ใส่งานลงคิวใน `sync_log` แล้วให้ sync worker เป็นตัวเดียวที่รัน

1. ผู้สั่งงานเพิ่มแถว `sync_log` ที่มี `status: queued` แยกตาม source แล้วได้ `sync_id` กลับไปทันที
2. Worker รับงานผ่าน Postgres `LISTEN/NOTIFY` (และ poll ทุก 30 วินาทีเผื่อ notify หลุด) จากนั้นเปลี่ยนสถานะเป็น `running` → `ok` / `error`
3. ถ้า source นั้นมีงาน `queued` หรือ `running` อยู่แล้ว ให้คืน `sync_id` ของงานเดิมแทนการสร้างงานใหม่ จะได้ไม่มีงานซ้อนกัน
4. Cooldown: ถ้า source นั้น sync สำเร็จไปไม่ถึง 5 นาทีที่แล้ว ให้คืนผลรอบนั้นโดยไม่สร้างงานใหม่ เพื่อกันการโดน rate limit จาก Google
5. หลัง sync เสร็จ worker จะคำนวณ `daily_summary` ใหม่เฉพาะวันที่ข้อมูลเปลี่ยน ก่อนตั้งสถานะเป็น `ok`

**Optional: เขียนกลับ Google Health**

- `nutrition-log` รองรับ create จึงเขียนมื้ออาหารกลับเข้า Google Health ได้ เปิดเป็น flag ไว้ ค่าเริ่มต้นปิด

## Data model

Hub ใช้ Postgres เก็บทุกอย่างตามวันในเวลาไทย (`Asia/Bangkok`) โดยมี `daily_summary` เป็นตารางกลางที่ทั้ง dashboard และ Claude อ่าน

| Table | Key | Columns หลัก | ที่มา |
| --- | --- | --- | --- |
| `daily_summary` | `date` | steps, total\_kcal\_out, active\_kcal, kcal\_in, protein\_g, carb\_g, fat\_g, sleep\_min, sleep\_score, resting\_hr, hrv\_ms, vo2max, weight\_kg, gym\_volume\_kg, run\_km | คำนวณจากตารางอื่นหลัง sync |
| `run_session` | `source_id` | date, start\_at, duration\_s, distance\_m, avg\_pace\_s\_per\_km, avg\_hr, max\_hr, hr\_zone\_min (jsonb), kcal, elevation\_m | Google Health `exercise` |
| `hr_sample` | `ts` | bpm | Google Health `heart-rate` (เก็บเฉพาะช่วงที่มี session) |
| `sleep_session` | `source_id` | date, start\_at, end\_at, stages (jsonb) | Google Health `sleep` |
| `gym_workout` | `opengym_id` | date, routine, duration\_s, total\_volume\_kg, prs (jsonb) | openGym |
| `gym_set` | `id` | workout\_id, exercise, muscle, set\_no, weight\_kg, reps, rir, is\_warmup | openGym |
| `meal` | `id` | eaten\_at, name, items (jsonb), kcal, protein\_g, carb\_g, fat\_g, confidence, photo\_url, note | MCP `log_meal` |
| `analysis` | `id` | date, kind (daily / run / workout / weekly / meal), title, summary\_md, scores (jsonb), recommendations (jsonb), created\_at | MCP `save_analysis` |
| `goal` | `key` | value, unit, updated\_at | ตั้งเอง (เช่น kcal\_target, protein\_target, weight\_target) |
| `sync_log` | `id` | source, trigger (cron / dashboard / mcp), status (queued / running / ok / error), queued\_at, started\_at, finished\_at, rows, error | คิวงาน sync + ประวัติ (ผู้สั่งเพิ่มแถว, worker อัปเดต) |
| `oauth_token` | `provider` | access\_token\_enc, refresh\_token\_enc, expires\_at | OAuth flow |

**กติกา**

- Upsert ด้วย key ของ source ทุกครั้ง เพื่อให้ re-sync ซ้ำได้โดยไม่เกิดข้อมูลซ้ำ
- `daily_summary` คำนวณใหม่ทั้งแถวทุกครั้งที่ข้อมูลของวันนั้นเปลี่ยน
- `weight_kg` ใช้ Google Health `weight` เป็นแหล่งเดียว ถ้าวันนั้นมีหลายค่า ให้ใช้ค่าแรกของวัน (ชั่งตอนเช้า) และถ้าวันนั้นไม่มีค่า ให้เป็น null ไม่ยกค่าวันก่อนมาใส่
- `analysis` ไม่ทับของเก่า dashboard แสดงตัวล่าสุดของแต่ละ kind ต่อวัน

## MCP server

เป็น Remote MCP server (Streamable HTTP over HTTPS) ที่เพิ่มเป็น custom connector ใน claude.ai ใช้ได้ทั้งบนเว็บ แอป Pixel 9 และ scheduled task โดยตัว tool จะคืนข้อมูลที่สรุปแล้ว ไม่คืน raw data เพื่อประหยัด context และโควตา

| Tool | ประเภท | Input | Output |
| --- | --- | --- | --- |
| `get_day_summary` | read | `date` | แถว `daily_summary` + เทียบกับ goal + ค่าเฉลี่ย 7 วัน |
| `get_range_summary` | read | `from`, `to` | daily\_summary รายวัน + ค่าเฉลี่ยรวมของช่วงนั้น |
| `get_runs` | read | `from`, `to` | รายการ run พร้อม pace, HR, เวลาในแต่ละ HR zone |
| `get_run_detail` | read | `run_id` | split ราย km + HR ที่ downsample เหลือราว 60 จุด |
| `get_workouts` | read | `from`, `to` | workout + volume แยกกล้ามเนื้อ + PR |
| `get_meals` | read | `date` | มื้อทั้งหมดของวัน + รวม macro |
| `get_goals` / `set_goal` | read / write | `key`, `value` | เป้าแคล, โปรตีน, น้ำหนัก |
| `log_meal` | write | `name`, `items[]`, `kcal`, `protein_g`, `carb_g`, `fat_g`, `confidence`, `eaten_at`? | `meal_id` + ยอดรวมวันนี้หลังบันทึก |
| `create_photo_upload` | write | `meal_id` | URL สำหรับ `PUT` รูป ใช้ได้ครั้งเดียว หมดอายุใน 10 นาที (`mcp.<domain>/upload/<token>`) |
| `update_meal` / `delete_meal` | write | `meal_id`, fields | แก้เมื่อประเมินผิดหรือกินไม่หมด |
| `save_analysis` | write | `date`, `kind`, `title`, `summary_md`, `scores`?, `recommendations`? | `analysis_id` |
| `get_latest_analysis` | read | `kind`?, `limit`? | ผลวิเคราะห์ล่าสุด (ไว้ให้ Claude อ้างอิงต่อเนื่อง) |
| `trigger_sync` | write | `source`?, `wait_s`? (ค่าเริ่มต้น 20, สูงสุด 25) | เพิ่มงานเข้าคิวแล้วรอไม่เกิน `wait_s` วินาที คืน `sync_id` ต่อ source + สถานะ (`ok` / `error` / ยัง `running`) + จำนวนแถว |
| `get_sync_status` | read | `sync_id`? | สถานะของงานนั้น หรือถ้าไม่ระบุ จะคืน sync ล่าสุดของแต่ละ source |

**Auth & ความปลอดภัย**

- ใช้ OAuth ตามที่ claude.ai custom connector รองรับ หรืออย่างน้อยใช้ secret path + token ยาวที่เดาไม่ได้
- Write tool ทั้งหมดเขียนได้เฉพาะตาราง `meal`, `analysis` และ `goal` เท่านั้น ไม่มี tool ลบข้อมูล sync
- ทุก write บันทึก audit (tool, args, เวลา)

**Tool description:** เขียนให้ Claude รู้หน่วยชัดเจน (kcal, g, s/km) และระบุว่า `confidence` เป็นค่า 0–1 ใช้บอกความไม่แน่นอนของการประเมินจากรูป

## AI analysis workflows

งาน AI มี 2 แบบ: แบบอัตโนมัติผ่าน scheduled task ของ Claude และแบบที่นายเปิดแชตเอง ทั้งสองแบบเขียนผลกลับด้วย `save_analysis` เพื่อให้ dashboard แสดงได้

**1. Daily analysis (scheduled task ทุกวัน 09:00 วิเคราะห์ของเมื่อวาน)**

รันตอนเช้าเพื่อให้ได้ข้อมูลของเมื่อวานครบทั้งวัน รวมถึงการนอนเมื่อคืน

1. เรียก `trigger_sync` ถ้ายัง `running` ให้เรียก `get_sync_status` ซ้ำได้ไม่เกิน 2 ครั้ง ถ้าสุดท้ายเป็น `error` หรือยังไม่เสร็จ ให้วิเคราะห์ต่อจากข้อมูลที่มี แล้วระบุไว้ใน summary ว่าข้อมูลอาจไม่ครบ
   จากนั้นเรียก `get_day_summary(yesterday)`, `get_runs`, `get_workouts`, `get_meals` ของเมื่อวาน
2. เทียบกับ goal และค่าเฉลี่ย 7 วัน
3. เขียน `save_analysis(date: yesterday, kind: daily)`: แคลเข้า-ออก, โปรตีนถึงเป้าไหม, ความหนักของการซ้อม, recovery (sleep เมื่อคืน, HRV, resting HR) และคำแนะนำสำหรับวันนี้ไม่เกิน 3 ข้อ
4. ถ้ามี run หรือ workout ในวันนั้น เขียน `kind: run` / `kind: workout` แยกอีกอัน

**2. Weekly review (scheduled task ทุกวันจันทร์ 09:30 วิเคราะห์สัปดาห์ที่แล้ว จันทร์–อาทิตย์)**

รันหลัง daily analysis ของวันจันทร์ ซึ่ง sync ข้อมูลถึงวันอาทิตย์ครบแล้ว

1. เรียก `get_sync_status` ถ้า sync ล่าสุดเป็น `error` หรือเก่ากว่า 12 ชั่วโมง ให้เรียก `trigger_sync` ก่อน
2. `get_range_summary` ของสัปดาห์ที่แล้ว + 4 สัปดาห์ก่อนหน้า, `get_workouts` และ `get_runs` ของสัปดาห์ที่แล้ว, `get_goals` และ `get_latest_analysis(kind: weekly, limit: 1)` เพื่อดูว่าคำแนะนำของสัปดาห์ก่อนถูกทำตามไหม
3. เขียน `save_analysis(date: วันอาทิตย์ที่จบสัปดาห์, kind: weekly)`:
   - น้ำหนัก: ค่าเฉลี่ย 7 วันเทียบสัปดาห์ก่อน และอัตราเปลี่ยนต่อสัปดาห์เทียบกับเป้า
   - พลังงาน: แคลเข้าเฉลี่ยเทียบแคลออกเฉลี่ย, จำนวนวันที่โปรตีนถึงเป้า, จำนวนวันที่ log อาหารครบ
   - เวท: จำนวน session, volume ต่อกล้ามเนื้อเทียบค่าเฉลี่ย 4 สัปดาห์, PR ใหม่, กล้ามเนื้อที่ไม่ได้เล่นเลย
   - วิ่ง: ระยะรวม, จำนวน run, สัดส่วนเวลาใน zone 2 กับ zone 4–5, แนวโน้ม VO2 max
   - Recovery: sleep, HRV และ resting HR เฉลี่ยเทียบ 4 สัปดาห์
   - `scores`: `{nutrition, training, running, recovery}` แต่ละตัว 0–100
   - `recommendations`: สิ่งที่ควรทำในสัปดาห์นี้ไม่เกิน 3 ข้อ
4. ถ้าสัปดาห์นั้นมีวันที่ไม่มีข้อมูลเกิน 2 วัน (เช่น ไม่ได้ใส่นาฬิกาหรือไม่ได้ log อาหาร) ให้ระบุใน summary และไม่ตัดสินแนวโน้มจากข้อมูลส่วนนั้น

**3. Meal logging (นายทำเองในแชต)**

1. ส่งรูปข้าวเข้า Project "Fitness Hub" ใน Claude app (ใส่ instruction ไว้ใน Project แล้ว)
2. Claude แยกรายการอาหาร ประเมินปริมาณ คำนวณแคลและ macro แล้วบอก `confidence`
3. ถ้า confidence ต่ำกว่า 0.6 ให้ถามคำถามเดียว (เช่น "ข้าวกี่ทัพพี") ก่อนบันทึก
4. เรียก `log_meal` แล้วตอบยอดรวมวันนี้กับแคลที่เหลือ
5. (Optional) แนบรูป: เรียก `create_photo_upload(meal_id)` ซึ่งคืน URL แบบใช้ได้ครั้งเดียวที่หมดอายุใน 10 นาที จากนั้นใช้ code execution ใน chat รัน `curl -X PUT --data-binary @<ไฟล์รูปที่อัปโหลด> <url>` hub จะเก็บรูปไว้ในเครื่องแล้วตั้ง `meal.photo_url`
   - ต้องเปิด code execution และเพิ่ม `mcp.<domain>` ใน allowed domains ของ network egress ใน claude.ai settings
   - URL ผูกกับ `meal_id` เดียว จึงไม่ต้องใส่ token ถาวรไว้ใน Project instructions
   - Endpoint อยู่บน `mcp.<domain>` ที่เปิด public อยู่แล้ว ทำให้ `fit.<domain>` อยู่หลัง Cloudflare Access ได้ทั้งหมดโดยไม่ต้องยกเว้น path ไหน ส่วน `/upload/*` ใช้ one-time token เป็น auth และรับเฉพาะ `image/*` ไม่เกิน 10 MB
   - MCP service รับไฟล์แล้วเขียนลง volume รูปอาหารที่ใช้ร่วมกับ Hub API เพื่อให้ dashboard แสดงรูปได้
   - ถ้าขั้นนี้ล้มเหลว มื้ออาหารก็ยังถูกบันทึกแล้ว แค่ไม่มีรูป และขั้นนี้ไม่นับรวมในเกณฑ์ 30 วินาที

**4. Ad-hoc (นายถามเอง)**

- เช่น "วิเคราะห์การวิ่งวันนี้" → `get_run_detail` แล้วดู pace, cardiac drift, เวลาในแต่ละ zone เทียบกับ run ก่อนหน้า จากนั้น `save_analysis(kind: run)`
- เช่น "พรุ่งนี้ควรเล่นขาไหม" → ดูข้อมูล recovery + workout ล่าสุด แล้วตอบ ไม่ต้อง save

**Prompt / Project instructions** เก็บไว้ใน repo (`prompts/daily.md`, `prompts/meal.md`) เพื่อให้ scheduled task กับ Project ใช้ข้อความชุดเดียวกัน

**ข้อควรรู้:** การประเมินแคลจากรูปคลาดเคลื่อนได้ประมาณ ±20–30% (โดยเฉพาะน้ำมันกับซอส) dashboard จึงควรเน้นแสดงแนวโน้ม 7 วันมากกว่าตัวเลขรายมื้อ

## Dashboard PWA

เป็น PWA เดียวบน Pixel 9 (Add to Home Screen ผ่าน Chrome) อ่านข้อมูลจาก hub API แบบ read-only และแสดงผลวิเคราะห์ล่าสุดของ Claude ไว้บนสุดของหน้า Today

| หน้า | Widget |
| --- | --- |
| Today | การ์ดผลวิเคราะห์ daily ล่าสุด · วงแหวนแคลเข้า/ออก/เหลือ · แถบ P/C/F เทียบเป้า · sleep + HRV + resting HR เทียบค่าเฉลี่ย 7 วัน · รายการมื้อวันนี้ |
| Training | Workout ล่าสุด + PR · volume ต่อกล้ามเนื้อรายสัปดาห์ · ปุ่มเปิด openGym |
| Running | Run ล่าสุด (ระยะ, pace, HR zone) · ระยะสะสมรายสัปดาห์ · กราฟ VO2 max |
| Body | กราฟน้ำหนักเทียบเป้า · แนวโน้มแคลเฉลี่ย 7 วัน |
| Insights | ผลวิเคราะห์ทั้งหมดเรียงตามวัน กรองตาม kind |

**พฤติกรรม**

- โหลดจาก cache ก่อน แล้วค่อย refresh เมื่อเปิดแอป แสดง "อัปเดตล่าสุด" จาก `sync_log`
- ปุ่ม Sync now เรียก `POST /api/sync` (ได้ `202` + `sync_id`) แล้ว poll `GET /api/sync/:id` ทุก 3 วินาที ระหว่างรอให้แสดง spinner พอเสร็จให้โหลดข้อมูลใหม่ และถ้า error ให้แสดงข้อความจาก `sync_log.error`
- Hub API และ MCP ใช้ฟังก์ชันใส่งานเข้าคิวตัวเดียวกัน (ดู Sync job) dashboard จึงไม่ต้องคุยกับ MCP
- ปุ่ม "ถาม Claude" เป็น deep link เปิด Claude app (ใส่ข้อความเองไม่ได้ จึงแค่เปิด Project)
- Login ด้วย passkey หรืออยู่หลัง Cloudflare Access แบบเดียวกับ openGym

**Stack:** React + Vite + Recharts, ใช้ domain เดียวกับ hub เช่น `fit.<domain>`

## Non-functional requirements

เป็นข้อมูลสุขภาพส่วนตัว จึงต้องปิด public ทั้งหมด ยกเว้น MCP endpoint ที่ Claude ต้องเรียกถึง และค่าใช้จ่ายคงที่มีแค่ค่า domain

| ด้าน | Requirement |
| --- | --- |
| Security | HTTPS ทุก endpoint · MCP ต้องมี auth · token ของ Google เข้ารหัสใน DB · dashboard/openGym อยู่หลัง passkey หรือ Cloudflare Access |
| Privacy | ไม่ส่งข้อมูลให้ third party นอกจาก Claude (ผ่าน MCP) · รูปอาหารเก็บบน laptop server (รวมอยู่ใน backup) · ปิด telemetry |
| Reliability | Sync idempotent (upsert) · retry แบบ exponential backoff เมื่อเจอ 429/504 · `sync_log` แจ้ง error บน dashboard |
| Backup | Dump Postgres + `./data` ของ openGym + โฟลเดอร์รูปอาหาร ทุกคืน ส่งไปเก็บนอกเครื่อง (เช่น Google Drive หรือ R2) เก็บ 14 วัน |
| Cost | Server 0 บาท (laptop เก่า) + ค่าไฟ · domain \~400 บาท/ปี · LLM = 0 (ใช้ subscription) |
| Ops | Docker Compose ไฟล์เดียว · ตั้ง health check + แจ้งเตือนเมื่อ sync ล้มติดกัน 2 วัน · เปิดจอค้างไว้ ห้ามพับ (ค่าเริ่มต้นของเครื่องคือพับแล้ว suspend) · ปิด idle sleep ตอนเสียบไฟ (ตั้งไว้แล้ว) · Docker เปิดเองหลังรีบูต · จำกัดชาร์จแบตไว้ราว 80% ถ้าเครื่องรองรับ |
| Performance | Dashboard โหลดจาก cache ไม่เกิน 1 วินาที · MCP tool ตอบไม่เกิน 3 วินาที ยกเว้น `trigger_sync` ที่รอได้ไม่เกิน 25 วินาที · `POST /api/sync` ตอบไม่เกิน 500 ms |

## Milestones & risks

แบ่งงานเป็น 4 สัปดาห์ โดยแต่ละสัปดาห์จบแล้วใช้งานได้ทันที และถ้าทำแค่ Week 1 ก็ได้ประโยชน์แล้วคือเลิกใช้ Hevy ได้

&#91;embedded content: roadmap · 4 weeks, 4 gates\]

แต่ละสัปดาห์มี gate (รูปเพชร) เป็นเกณฑ์ว่าผ่านแล้วถึงจะไปสัปดาห์ต่อไป

| Risk | ผลกระทบ | วิธีรับมือ |
| --- | --- | --- |
| Refresh token ของ Google หมดอายุทุก 7 วันถ้า OAuth app อยู่ในโหมด Testing (ต้องเช็กใน docs) | Sync หยุดเงียบๆ | แจ้งเตือนบน dashboard + หน้า re-consent กดครั้งเดียว · ดูว่าใช้โหมด Production แบบ personal ได้ไหม |
| ใช้โควตา Claude ไปกับงานอัตโนมัติ | ชนกับงานอื่นในวันที่ใช้หนัก | Tool คืนข้อมูลที่สรุปแล้ว · daily analysis วันละครั้ง |
| Scheduled task หรือ connector เปลี่ยนพฤติกรรม | Analysis ไม่ถูกเขียน | Dashboard แสดงว่าผลวิเคราะห์ล่าสุดเป็นของวันไหน · รันเองจากแชตได้เสมอ |
| แคลจากรูปคลาด ±20–30% | ตัดสินใจเรื่องอาหารผิด | เก็บ confidence · ถามเมื่อไม่มั่นใจ · ดูแนวโน้ม 7 วัน |
| openGym เปลี่ยน API หลังอัปเดต | Sync gym พัง | Pin image version · มี test สำหรับ sync |
| Laptop ดับ, เน็ตหอหลุด หรือดิสก์พัง | เสียประวัติ | Backup นอกเครื่องทุกคืน · sync ย้อน 2 วันอยู่แล้ว รอบที่พลาดจะตามเก็บเอง · ตั้งให้เครื่องเปิดเองเมื่อไฟกลับ ถ้า BIOS รองรับ |

**Open questions**

- [ ] Claude.ai custom connector รองรับ auth แบบไหนบ้าง (OAuth / header) ตอนนี้
- [ ] OAuth app แบบ personal ของ Google Health ต้องผ่าน verification ไหม หรืออยู่ Testing ได้ตลอด
- [x] openGym API ใช้ auth แบบ session cookie อย่างเดียว หรือมี API token ให้ hub ใช้ → มี bearer token จากการ pair แบบเดียวกับแอปมือถือ (ดู Data sources)
- [ ] Code execution ใน claude.ai เข้าถึงรูปที่ส่งในแชตเป็นไฟล์ได้ไหม (รวมถึงบนแอป Android และใน Project) และ allowlist โดเมนเองได้ไหม ถ้าไม่ได้ ให้เก็บแค่ผลประเมิน (`photo_url` เป็น null)
- [ ] Timeout ของ tool call ใน claude.ai ยาวพอให้ `trigger_sync` รอ 25 วินาทีไหม
