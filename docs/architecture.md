# Spry — containers (C4, level 2)

The Lab 1 container diagram, updated for lab 6. The new parts are the agenda parser and Amazon
Bedrock. There are two paths: **parse** (browser → parser → Bedrock) and **save** (browser → API
→ database).

```mermaid
C4Container
  title Spry - containers (after lab 6)

  Person(lead, "Team lead", "Plans meetings, pastes agendas")

  System_Boundary(spry, "Spry") {
    Container(spa, "Web app", "React + Vite, S3 + CloudFront", "Meetings, agendas, Paste an agenda")
    Container(api, "API", "FastAPI on ECS Fargate, in the VPC", "Meetings and agendas; validates every write")
    ContainerDb(db, "Database", "RDS PostgreSQL, in the VPC", "meetings, agendas (+ ai_suggestion)")
    Container(parser, "Agenda parser", "Python Lambda + function URL, outside the VPC", "Pasted text -> suggested agenda JSON; never writes")
    Container(reports, "Weekly report", "Scheduler -> SQS -> Lambda -> S3 -> Lambda", "Lab 5")
  }

  System_Ext(cognito, "Amazon Cognito", "Sign-in (lab 4), issues access tokens")
  System_Ext(bedrock, "Amazon Bedrock", "Claude Opus 5.5, bedrock-mantle, us-east-1")
  System_Ext(ses, "Amazon SES", "Report emails")

  Rel(lead, spa, "Uses", "HTTPS")
  Rel(spa, cognito, "Signs in", "OIDC + PKCE")
  Rel(spa, parser, "1. parse: text + access token", "HTTPS POST")
  Rel(parser, cognito, "Fetches JWKS to verify the token", "HTTPS")
  Rel(parser, bedrock, "2. messages.create with record_agenda", "HTTPS, IAM role")
  Rel(spa, api, "3. save: POST /api/meetings/{id}/agenda", "HTTPS JSON")
  Rel(api, db, "Reads and writes", "SQL")
  Rel(reports, db, "Reads", "SQL")
  Rel(reports, ses, "Emails the CSV")
```

Plain-text version:

```
                              +-------------------- AWS ---------------------------------+
team lead --HTTPS--> web app  |                                                          |
 (browser)  (S3+CloudFront)   |   outside the VPC                 us-east-1              |
     |                        |   agenda parser (Lambda URL) ---> Amazon Bedrock (Claude)|
     |--1. parse ------------>|        | JWKS                                            |
     |                        |        v                                                 |
     |                        |   Amazon Cognito                                         |
     |                        |                                                          |
     |                        |   VPC, no NAT                                            |
     |--3. save ------------->|   API (ECS Fargate) ---> RDS PostgreSQL                  |
                              |                          (meetings, agendas)             |
                              +----------------------------------------------------------+
```

Why the two paths differ is in [ADR 0006](adr/0006-llm-agenda-parsing.md).
