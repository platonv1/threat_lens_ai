# AWS_Deployment_Guide.md

# AWS Deployment Guide

## Project

**Cyber Scam Shield Assistant AI**

---

# Objective

This document describes the deployment process for Cyber Scam Shield Assistant AI from a local development environment to Amazon Web Services (AWS).

The goal is to:

* Keep development completely local.
* Deploy only stable versions to AWS.
* Learn AWS using industry best practices.
* Start with a simple architecture and gradually improve it.

---

# Local Development Workflow

All new features should be developed and tested locally before deployment.

```text
Mac Development Machine
        │
        ▼
Develop New Feature
        │
        ▼
Test Locally
        │
        ▼
Git Commit
        │
        ▼
GitHub Repository
        │
        ▼
Deploy to AWS
        │
        ▼
Production Website
```

**Never develop directly on the AWS server.**

---

# Phase 1 – Prepare the Project

Before deploying to AWS, verify that everything works locally.

## Checklist

* [ ] React frontend builds successfully.
* [ ] FastAPI backend starts without errors.
* [ ] PostgreSQL database works.
* [ ] Environment variables are stored in `.env`.
* [ ] Docker containers (if used) run correctly.
* [ ] Application has been fully tested.

---

# Phase 2 – Create an AWS Account

1. Create an AWS account.
2. Add a payment method.
3. Enable Multi-Factor Authentication (MFA).
4. Create an IAM Administrator user.
5. Avoid using the Root account for daily work.

---

# Phase 3 – Deployment Architecture

Initial architecture:

```text
                Internet
                    │
                    ▼
             React Frontend
                    │
                    ▼
              Amazon EC2
          (FastAPI Backend)
                    │
      ┌─────────────┼──────────────┐
      ▼             ▼              ▼
 Amazon RDS      Amazon S3      Ollama
 PostgreSQL     File Storage    AI Model
```

Services used:

* EC2
* RDS PostgreSQL
* S3
* IAM
* CloudWatch

---

# Phase 4 – Learn the Core AWS Services

Focus only on these services.

| Service    | Purpose                      |
| ---------- | ---------------------------- |
| EC2        | Runs the application         |
| RDS        | PostgreSQL database          |
| S3         | Stores uploaded screenshots  |
| IAM        | User permissions             |
| CloudWatch | Monitoring and logs          |
| Route 53   | Domain management (optional) |

Ignore advanced services until the application is stable.

---

# Phase 5 – Launch an EC2 Instance

## Which AWS Account to Use

**Log in as the IAM Administrator user created in Phase 2 — never the Root user.**

* Root user = only for account-level tasks (billing, closing the account, initial MFA setup).
* IAM Administrator user = used for everyday work, including launching EC2 instances.
* Sign in at `https://<your-account-id-or-alias>.signin.aws.amazon.com/console`, not the root sign-in page.
* Confirm MFA is enabled on the IAM user before continuing.

## Steps to Launch the Instance

1. Sign in to the AWS Console as the IAM Administrator user.
2. Select the target AWS Region (top-right corner). Use the same Region for every resource (EC2, RDS, S3) to avoid cross-Region networking issues.
3. Navigate to **EC2 → Instances → Launch instance**.
4. **Name and tags** — give the instance a clear name, e.g. `cyber_scam_instance_prod`.
5. **Application and OS Image (AMI)** — select **Ubuntu Server 24.04 LTS** (Free tier eligible where applicable).
6. **Instance type** — select `t3.small` (light workloads/testing) or `t3.medium` (recommended if running Ollama models locally on the instance).
7. **Key pair (login)**:
   * Click **Create new key pair**.
   * Name it (e.g. `cyber-scam-shield-assistant-ai-key`), type `RSA`, format `.pem`.
   * Download and store the `.pem` file securely — it cannot be downloaded again.
   * Restrict local file permissions: `chmod 400 cyber-scam-shield-assistant-ai-key.pem`.
8. **Network settings**:
   * Use the default VPC (or a project-specific VPC if one exists).
   * Enable **Auto-assign public IP**.
   * Create a new security group named e.g. `cyber-scam-shield-assistant-ai-sg` and add the inbound rules listed below.
9. **Configure storage** — set 30–50 GB, type `gp3` (General Purpose SSD).
10. Review the summary panel, then click **Launch instance**.
11. Wait for the instance state to show **Running** and all status checks to show **passed** (this may read **2/2** or **3/3** depending on the console version — newer accounts include a third **Attached EBS status check** alongside the System and Instance checks. Either is fine as long as all checks pass).
12. Note the **Public IPv4 address** — it is needed to connect via SSH (Phase 6).

## Security Group — Inbound Rules

| Port | Protocol | Source                        | Purpose                |
| ---- | -------- | ------------------------------ | ----------------------- |
| 22   | TCP      | My IP (not `0.0.0.0/0`)        | SSH                     |
| 80   | TCP      | `0.0.0.0/0`                     | HTTP                    |
| 443  | TCP      | `0.0.0.0/0`                     | HTTPS                   |
| 8000 | TCP      | My IP                          | FastAPI (testing only)  |

Restricting SSH (port 22) to "My IP" instead of the whole internet significantly reduces the attack surface. Update this rule if your IP address changes.

---

# Phase 6 – Connect to EC2

## Prerequisites

* The instance state is **Running** with all status checks passed (Phase 5).
* You have the `.pem` key pair file downloaded during launch.
* Your current public IP is allowed in the security group's port 22 rule (Phase 5). If your IP changed since launch, update the rule first or the connection will time out.

## 1. Locate the Public IP

1. Open **EC2 → Instances** in the AWS Console.
2. Select the instance.
3. Copy the **Public IPv4 address** (or **Public IPv4 DNS**) from the details panel.

## 2. Set Key Permissions

SSH refuses to use a private key file if its permissions allow other users to read it. This command must be run **once**, **locally on your Mac** (not on the EC2 instance), directly in **Terminal** — do not double-click the `.pem` file itself.

1. Open the **Terminal** app.

2. Navigate to the folder where the `.pem` file was saved. Browsers typically save downloads to `~/Downloads`:

   ```bash
   cd ~/Downloads
   ```

   If you saved it somewhere else (e.g. Desktop, or a project folder), `cd` there instead. Not sure where it went? Check in Finder first, or list your Downloads folder to confirm the file is there:

   ```bash
   ls -l ~/Downloads/*.pem
   ```

3. Replace `your-key.pem` with the actual file name you chose in Phase 5 (e.g. `cyber-scam-shield-assistant-ai-key.pem`) and run:

   ```bash
   chmod 400 your-key.pem
   ```

   `400` means: the file owner can **read only** — no writing, no executing, and no access for anyone else. This matches what SSH requires for private keys.

4. Confirm the permissions were applied:

   ```bash
   ls -l your-key.pem
   ```

   The output should start with `-r--------`, e.g.:

   ```
   -r-------- 1 vince staff 1678 Aug  6 09:15 cyber-scam-shield-assistant-ai-key.pem
   ```

If you skip this step, SSH will refuse to connect and show an error like:

```
Permissions 0644 for 'your-key.pem' are too open.
It is required that your private key files are NOT accessible by others.
```

If you see that error, just rerun `chmod 400 your-key.pem` on the file.

## 3. Connect via SSH

The default username for Ubuntu AMIs is `ubuntu`.

```bash
ssh -i your-key.pem ubuntu@YOUR_PUBLIC_IP
```

Example:

```bash
ssh -i cyber-scam-shield-assistant-ai-key.pem ubuntu@34.201.55.12
```

On first connection, SSH will ask to confirm the host's fingerprint:

```
The authenticity of host '34.201.55.12' can't be established.
Are you sure you want to continue connecting (yes/no)?
```

**Yes, type `yes` and press Enter — this is expected and safe to accept.**

Why this is normal:

* SSH has never connected to this IP before, so it can't yet verify the server's identity against a known record. This prompt appears the very first time you connect to any new host — it doesn't mean something is wrong.
* Since you just launched this instance yourself (Phase 5) and copied the IP directly from the AWS Console, you can trust it's the correct server.
* After you type `yes`, SSH saves the host's fingerprint to `~/.ssh/known_hosts` on your Mac and will **not** ask again for this IP on future connections.

When you *should* be cautious: if this warning appears again later for the *same* IP (after you already connected once before) and says `WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!` — that's different from the first-time prompt above, and usually just means the EC2 instance got a new public IP after a stop/start (see Troubleshooting below), not a security issue. Confirm the IP still matches the one shown in the AWS Console before continuing.

## 4. Troubleshooting

| Problem                              | Likely Cause                                                        |
| ------------------------------------- | --------------------------------------------------------------------- |
| `Connection timed out`                | Port 22 not open for your current IP, or instance not running        |
| `Permission denied (publickey)`       | Wrong username, wrong key file, or key permissions not set to `400`  |
| `UNPROTECTED PRIVATE KEY FILE` warning | Key file permissions too open — rerun `chmod 400 your-key.pem`       |
| `Host key verification failed`        | Public IP was reused by a different instance — remove the old entry from `~/.ssh/known_hosts` |

## 5. Optional: Simplify Future Connections

Add an entry to `~/.ssh/config` on your Mac to avoid retyping the key path and IP every time.

1. Open (or create) the config file in a text editor. `nano` works well in Terminal:

   ```bash
   nano ~/.ssh/config
   ```

   If the file doesn't exist yet, `nano` will create it once you save.

2. Add this block at the end of the file. Replace `YOUR_PUBLIC_IP` with the instance's actual Public IPv4 address (Phase 6, Step 1), and update the `IdentityFile` path to match where your `.pem` file actually lives (e.g. `~/Downloads/...` if you never moved it):

   ```text
   Host cyber-scam-shield-assistant-ai
       HostName YOUR_PUBLIC_IP
       User ubuntu
       IdentityFile ~/.ssh/cyber-scam-shield-assistant-ai-key.pem
   ```

3. Save and exit:
   * In `nano`: press `Ctrl + O` (write out), then `Enter` to confirm, then `Ctrl + X` to exit.

4. The config file itself also needs restricted permissions, the same way the `.pem` key does:

   ```bash
   chmod 600 ~/.ssh/config
   ```

5. Connect using the short alias instead of the full command:

   ```bash
   ssh cyber-scam-shield-assistant-ai
   ```

   **The alias you type must exactly match the `Host` value in your config.** If you named it something else — e.g. `Host cyber_scam_shield` — you must connect with `ssh cyber_scam_shield`, not the name shown above. Using a different name than what's in the config produces:

   ```
   ssh: Could not resolve hostname cyber-scam-shield-assistant-ai: nodename nor servname provided, or not known
   ```

   because SSH found no matching `Host` entry and tried (and failed) to look it up as a real DNS name instead.

**Tip:** if you keep the `.pem` file outside `~/.ssh` (e.g. still in `~/Downloads`), either move it there (`mv ~/Downloads/cyber-scam-shield-assistant-ai-key.pem ~/.ssh/`) or point `IdentityFile` at its real location — the path in the config must match exactly.

**Note:** EC2 public IPs change on stop/start unless an Elastic IP is assigned. Update the `HostName` value in this config (or assign an Elastic IP) if the address changes.

---

# Phase 7 – Install Required Software

**Where to run these commands:** all commands in this phase run **inside your SSH session on the EC2 instance** (Phase 6) — not on your local Mac. Your terminal prompt should look like `ubuntu@ip-...:~$` before you start. If it instead shows your Mac's username, you're not connected — reconnect first with `ssh cyber_scam_shield_key` (or your alias from Phase 6).

## 1. Update the Package Index

Always update before installing anything — the Ubuntu AMI's package list is often outdated.

1. Type this command and press Enter:

   ```bash
   sudo apt update
   ```

   `sudo` runs the command with administrator privileges. On the standard Ubuntu EC2 AMI, the `ubuntu` user doesn't need a password for `sudo`, so it should run immediately without prompting you for one.

2. Then run:

   ```bash
   sudo apt upgrade -y
   ```

   This upgrades any already-installed packages to their latest version. The `-y` flag auto-confirms the prompt that would otherwise ask `Do you want to continue? [Y/n]`. This can take a minute or two on a fresh instance — let it finish before continuing.

## 2. Install Core Packages

Run this single command to install everything in one pass:

```bash
sudo apt install -y git python3 python3-pip python3-venv nginx docker.io
```

Again, `-y` auto-confirms the install prompt. Wait for the terminal prompt (`$`) to return before continuing — that means installation finished.

| Package        | Purpose                                             |
| --------------- | ---------------------------------------------------- |
| `git`           | Clone and update the repository from GitHub          |
| `python3`       | Runs the FastAPI backend                              |
| `python3-pip`   | Installs Python dependencies                          |
| `python3-venv`  | Creates an isolated Python environment (recommended)  |
| `nginx`         | Reverse proxy in front of FastAPI (Phase 13)          |
| `docker.io`     | Runs containerized services (Version 3 architecture)  |

## 3. Install Node.js and npm

The Ubuntu default `apt` version of Node.js is often outdated. Install a current LTS release via NodeSource — this is needed to build the React/Next.js frontend in Phase 9. Run these two commands one at a time, letting each finish before the next:

1. Add the NodeSource repository:

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
   ```

   This downloads and runs NodeSource's setup script, which registers a new `apt` source for a current Node.js LTS release. You'll see a stream of setup output — that's expected.

2. Install Node.js from that new source:

   ```bash
   sudo apt install -y nodejs
   ```

   This installs both `node` and `npm` together.

## 4. Allow Docker to Run Without `sudo` (Optional but Recommended)

```bash
sudo usermod -aG docker $USER
```

This adds the current user (`ubuntu`) to the `docker` group so you don't need `sudo` before every `docker` command. It doesn't take effect in your current session — **log out and reconnect** for the group change to apply:

```bash
exit
```

Then, back on your Mac, SSH in again (Phase 6, Step 5):

```bash
ssh cyber_scam_shield_key
```

## 5. Verify Installations

Back in your SSH session, run each command below one at a time:

```bash
git --version
python3 --version
pip3 --version
node --version
npm --version
nginx -v
docker --version
```

Each command should print a version number with no errors, for example:

```
git version 2.43.0
Python 3.12.3
pip 24.0
v20.x.x
10.x.x
nginx version: nginx/1.24.0
Docker version 24.x.x
```

If any command prints `command not found`, its install step above did not complete — scroll up and rerun that step.

## 6. Notes

* `python3-venv` is used later to create a virtual environment before installing backend dependencies (Phase 9), keeping project packages isolated from system Python.
* If the project later uses EasyOCR, install its system-level image libraries first: `sudo apt install -y libgl1 libglib2.0-0`.
* Skip the `docker.io` install if the project won't use Docker yet — it can be installed later when moving to the Version 3 containerized architecture.

---

# Phase 8 – Clone the GitHub Repository

**Where to run these commands:** still inside your SSH session on the EC2 instance (same as Phase 7) — not on your local Mac. Confirm your prompt still shows `ubuntu@ip-...:~$` before continuing.

This only needs to be done once, during the initial deployment. After this, updates are pulled with `git pull` (see "Updating the Application" later in this guide) instead of cloning again.

## 1. Clone the Repository

Run:

```bash
git clone https://github.com/platonv1/cyber_scam_shield_assistant_ai.git
```

What this does: downloads the full project (all files and git history) from GitHub into a new folder on the EC2 instance named `cyber_scam_shield_assistant_ai`, created in whatever directory you're currently in (typically `/home/ubuntu` right after login).

You should see output like:

```
Cloning into 'cyber_scam_shield_assistant_ai'...
remote: Enumerating objects: ...
Receiving objects: 100% ...
Resolving deltas: 100% ...
```

**If the repository is private**, this `https://` URL will instead prompt for a GitHub username and password — GitHub no longer accepts account passwords here, so that prompt will fail. In that case, use a [Personal Access Token](https://github.com/settings/tokens) in place of the password, or switch to a `git@github.com:...` SSH URL with a deploy key set up on the instance. Skip this if the repo is public — the command above will just work.

## 2. Move Into the Project Folder

Run:

```bash
cd cyber_scam_shield_assistant_ai
```

This changes your current directory into the newly cloned project. Confirm it worked by listing the folder contents:

```bash
ls
```

You should see the project's files (e.g. backend/frontend folders, `README.md`, etc.) rather than an empty listing.

## 3. Confirm You're on the Right Branch

```bash
git status
```

This should report `On branch main` (or whichever branch is meant for deployment) and `nothing to commit, working tree clean`. This is also a useful sanity check any time later if the app behaves unexpectedly after a `git pull`.

---

# Phase 9 – Install Dependencies

**Where to run these commands:** still inside your SSH session on the EC2 instance, starting from the project root folder you landed in at the end of Phase 8 (`cyber_scam_shield_assistant_ai`). Confirm with `pwd` — it should end in `.../cyber_scam_shield_assistant_ai`.

## Backend

1. Move into the backend folder:

   ```bash
   cd backend
   ```

2. Create an isolated Python environment. This is the `python3-venv` package installed back in Phase 7 — it keeps this project's Python packages separate from the system's Python:

   ```bash
   python3 -m venv venv
   ```

   This creates a new `venv/` folder inside `backend/` containing a private Python interpreter and package set.

3. Activate the virtual environment:

   ```bash
   source venv/bin/activate
   ```

   Your terminal prompt will change to show `(venv)` at the start, e.g. `(venv) ubuntu@ip-...:~/cyber_scam_shield_assistant_ai/backend$`. This confirms the environment is active. You'll need to re-run this `source` command every time you reconnect and want to work with the backend — it doesn't stay active across SSH sessions.

4. Install the backend's Python dependencies:

   ```bash
   pip install -r requirements.txt
   ```

   This reads `backend/requirements.txt` and installs each listed package (FastAPI, SQLAlchemy, etc.) into the active virtual environment. Expect a scroll of `Collecting ...` / `Installing collected packages ...` output. Wait for the prompt to return.

5. Return to the project root before moving to the frontend:

   ```bash
   cd ..
   ```

## Frontend

1. Move into the frontend folder:

   ```bash
   cd frontend
   ```

2. Install the frontend's Node dependencies:

   ```bash
   npm install
   ```

   This reads `frontend/package.json` and downloads all required packages into a new `frontend/node_modules/` folder. This step can take a few minutes on first run.

3. Build the production frontend bundle:

   ```bash
   npm run build
   ```

   This compiles the React/Next.js app into optimized static files (typically output to a `build/` or `.next/` folder), ready to be served by Nginx (Phase 13). A successful build ends with a "Compiled successfully" (or similar) message and no red error output.

4. Return to the project root when done:

   ```bash
   cd ..
   ```

---

# Phase 10 – Configure PostgreSQL

Unlike Phases 7–9, this phase happens in **two places**: creating the database is done in the **AWS Console** in your browser (signed in as the IAM Administrator user, same as Phase 5), and updating the connection string is done back in your **SSH session** on EC2.

Do **not** install PostgreSQL directly on the EC2 server unless required — using a managed RDS instance means AWS handles backups, patching, and failover for you.

## 1. Create the RDS PostgreSQL Instance (AWS Console)

1. Sign in to the AWS Console as the IAM Administrator user.
2. Confirm you're in the **same Region** as your EC2 instance (Phase 5) — RDS and EC2 must be in the same Region to connect efficiently.
3. In the AWS Console search bar, the service may be labeled **"Aurora and RDS"** (AWS merged these into one menu entry) — click it, then go to **Databases → Create database**.
4. **Choose a database creation method** — select **Full configuration** (this console may label it "Full configuration" rather than "Standard create" depending on your account/region). This gives full control over VPC, security group, and public access — needed for Step 2 below. Do **not** select **Express configuration** (AWS auto-picks settings, including public access, for you) or **Restore from S3** (that's for restoring an existing backup, not creating a new database).
5. **Engine options** — select **PostgreSQL**. Be careful not to select **Amazon Aurora PostgreSQL-Compatible Edition** by mistake — it's listed nearby but is a different (pricier, not Free-Tier-equivalent) engine. Leave the version at the latest default unless the project requires a specific one.
6. **Templates** — select **Free tier** (fine for learning/prototyping) or **Dev/Test** if Free tier isn't available on your account.
7. **Settings**:
   * **DB instance identifier** — e.g. `cyber-scam-shield-db`.
   * **Master username** — e.g. `postgres`.
   * **Master password** — set a strong password and store it somewhere safe (a password manager, not a plain text file in the repo). You'll need it in Step 3 below.
8. **Instance configuration** — `db.t3.micro` is enough for a prototype.
9. **Storage** — leave the defaults (20 GB gp3 is typical for Free tier).
10. **Connectivity**:
    * **Virtual private cloud (VPC)** — select the same VPC your EC2 instance is in.
    * **Public access** — select **No**. The database should only be reachable from your EC2 instance, not the open internet.
    * **VPC security group** — select **Create new**, name it e.g. `cyber-scam-shield-db-sg`.
    * **Compute resource** — select **Connect to an EC2 compute resource**, then choose your EC2 instance (`cyber_scam_instance_prod`) from the list. This is AWS's guided-connectivity option — it automatically adds the correct inbound security group rule (PostgreSQL/5432, sourced from your EC2 instance's security group) for you, which otherwise has to be done manually in Step 2 below.
11. Leave the remaining settings at their defaults, then click **Create database**.
12. Wait for the instance status to change from **Creating** to **Available** (this typically takes 5–10 minutes).

## 2. Allow the EC2 Instance to Reach the Database

**If you selected "Connect to an EC2 compute resource" in Step 1 above, this was already done for you — skip to Step 3.**

If you selected **"Don't connect to an EC2 compute resource"** instead (or created the database before this option was available), the new database security group blocks all inbound traffic by default — including from your own EC2 instance. Fix this manually:

1. Navigate to **EC2 → Security Groups**.
2. Select the security group you just created for RDS (`cyber-scam-shield-db-sg`).
3. Under **Inbound rules**, click **Edit inbound rules → Add rule**.
4. Set **Type** to **PostgreSQL** (this auto-fills port `5432`).
5. Set **Source** to the EC2 instance's security group (`cyber-scam-shield-assistant-ai-sg` from Phase 5) — not "My IP" and not `0.0.0.0/0`. This means only traffic originating from your EC2 instance can reach the database.
6. Save the rule.

## 3. Get the Connection Details

1. Navigate to **RDS → Databases**, and click your DB instance.
2. Under **Connectivity & security**, copy the **Endpoint** (looks like `cyber-scam-shield-db.xxxxxxxxxx.ap-southeast-2.rds.amazonaws.com`) and note the **Port** (default `5432`).

## 4. Update the Application's Connection String (EC2 SSH Session)

Back in your SSH session, connected to the EC2 instance:

1. Navigate to the backend folder if you're not already there:

   ```bash
   cd ~/cyber_scam_shield_assistant_ai/backend
   ```

2. Copy the example environment file if you haven't already created one:

   ```bash
   cp .env.example .env
   ```

3. Open `.env` in a text editor:

   ```bash
   nano .env
   ```

4. Find the `DATABASE_URL` line and replace it with your RDS details, using the format:

   ```
   DATABASE_URL=postgresql+psycopg2://MASTER_USERNAME:MASTER_PASSWORD@YOUR_RDS_ENDPOINT:5432/YOUR_DB_NAME
   ```

   Example:

   ```
   DATABASE_URL=postgresql+psycopg2://postgres:your-strong-password@cyber-scam-shield-db.xxxxxxxxxx.ap-southeast-2.rds.amazonaws.com:5432/postgres
   ```

   `postgres` at the end is the default database name RDS creates automatically — use it unless you created a differently named database.

5. Save and exit: `Ctrl + O`, `Enter`, then `Ctrl + X` (same as editing `~/.ssh/config` earlier).

6. Never commit `.env` to git — confirm it's listed in `.gitignore` (it should already be, since it holds secrets).

## 5. Verify the Connection

With the backend's virtual environment active (Phase 9):

```bash
source venv/bin/activate
python3 -c "from sqlalchemy import create_engine; import os; from dotenv import load_dotenv; load_dotenv(); create_engine(os.environ['DATABASE_URL']).connect(); print('Connected successfully')"
```

If this prints `Connected successfully`, the app can reach the database. If it hangs or times out, double-check the security group rule in Step 2 — that's the most common cause of connection failures here.

---

# Phase 11 – Configure Amazon S3

Like Phase 10, this phase happens in the **AWS Console**, signed in as the IAM Administrator user. Use it for:

* Uploaded screenshots
* Investigation reports
* Images
* Other uploaded files

**Note:** the backend does not yet have S3 upload code wired in (no `boto3` dependency, no bucket config in `.env.example` as of this writing). This phase sets up the AWS infrastructure only — connecting the app to it is a future development task, consistent with this project's incremental build approach.

## 1. Create the S3 Bucket

1. Sign in to the AWS Console as the IAM Administrator user.
2. Confirm you're in the same Region as your EC2 and RDS resources.
3. Navigate to **S3 → Buckets → Create bucket**.
4. **Bucket name** — must be globally unique across all of AWS, e.g. `cyber-scam-shield-uploads-<random-suffix>` (add a few random characters/numbers if the plain name is taken).
5. **Object Ownership** — leave at the default (**ACLs disabled**, bucket owner enforced).
6. **Block Public Access settings** — leave **all four boxes checked** (block all public access). Uploaded screenshots and investigation reports may contain sensitive scam evidence — this bucket should never be publicly readable.
7. **Bucket Versioning** — optional; **Enable** if you want protection against accidental overwrites/deletes (keeps prior versions of a file). Adds a small amount of storage cost since old versions are retained.
8. **Default encryption** — leave at the default (**SSE-S3**, Amazon S3-managed keys). This encrypts objects at rest automatically at no extra cost.
9. Leave remaining settings at their defaults, then click **Create bucket**.

## 2. Grant the EC2 Instance Access via an IAM Role

Do **not** generate long-lived AWS access keys and paste them into `.env` on the server — if the server is ever compromised, those keys leak too. Instead, attach an **IAM role** to the EC2 instance itself; AWS then supplies temporary credentials to anything running on it automatically.

1. Navigate to **IAM → Roles → Create role**.
2. **Trusted entity type** — select **AWS service**.
3. **Use case** — select **EC2**, then click **Next**.
4. **Add permissions** — search for and select **AmazonS3FullAccess** for now (fine for a prototype). For tighter security later, replace this with a custom policy scoped to only your specific bucket.
5. **Role name** — e.g. `cyber-scam-shield-ec2-s3-role`.
6. Click **Create role**.
7. Navigate to **EC2 → Instances** (the list view).
8. **Check the checkbox** next to your instance (`cyber_scam_instance_prod`) — the Actions menu's full options won't activate without this.
9. Click **Actions** at the top of the page. Depending on your console version, look for whichever of these appears:
   * **Security → Modify IAM role** (current console), or
   * **Instance Settings → Attach/Replace IAM Role** (older console layout)
10. Select the role you just created (`cyber-scam-shield-ec2-s3-role`) from the dropdown, then click **Update IAM role** (or **Apply**).

If neither menu item appears at all, confirm you're signed in as the IAM Administrator user (Phase 2) with full admin permissions — a restricted IAM user missing `iam:PassRole` / `ec2:AssociateIamInstanceProfile` permissions won't see this control.

This doesn't require rebooting the instance — the role takes effect within a minute or so.

## 3. Verify Access from the EC2 Instance

Back in your SSH session on EC2:

1. Install the AWS CLI, if not already present. The `apt` package (`awscli`) is often unavailable or outdated depending on which Ubuntu repos are enabled, so install AWS's official v2 bundle directly instead:

   ```bash
   sudo apt install -y unzip
   curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
   unzip awscliv2.zip
   sudo ./aws/install
   ```

   Verify it installed correctly:

   ```bash
   aws --version
   ```

   You should see output like `aws-cli/2.x.x Python/3.x.x Linux/...`.

2. List the bucket's contents — this should work with **no credentials configured**, since the IAM role attached in Step 2 supplies them automatically. Replace the bucket name below with your actual bucket name from Phase 11, Step 1 (copy it exactly from **S3 → Buckets** in the Console — names are case-sensitive):

   ```bash
   aws s3 ls s3://cyber-scam-shield-uploads-<your-suffix>
   ```

   Example, if your bucket is named `cyber-scam-shield-uploads-a17f`:

   ```bash
   aws s3 ls s3://cyber-scam-shield-uploads-a17f
   ```

   An empty result (the command just returns to your prompt with no output) confirms access is working — the bucket is just empty since nothing's been uploaded yet. No output is a success, not a failure.

   If you instead see `Unable to locate credentials` or `Access Denied`, double-check Step 2 — the IAM role either isn't attached or doesn't have S3 permissions.

## 4. Next Steps (Future Development)

When the file-upload feature is actually built into the backend, it will need:

* `boto3` added to `backend/requirements.txt`
* A bucket name variable added to `.env` (e.g. `AWS_S3_BUCKET_NAME=cyber-scam-shield-uploads-<your-suffix>`)
* Upload/download logic using `boto3.client("s3")`, which will pick up the EC2 instance's IAM role credentials automatically — no access keys needed in code either.

---

# Phase 12 – Start FastAPI

**Where to run these commands:** in your SSH session on EC2, from inside the `backend` folder, with the virtual environment active (Phase 9).

## 1. Activate the Virtual Environment (if not already active)

If you reconnected since Phase 9, the `(venv)` prefix won't be showing yet — reactivate it:

```bash
cd ~/cyber_scam_shield_assistant_ai/backend
source venv/bin/activate
```

Confirm your prompt now starts with `(venv)`.

## 2. Start the FastAPI Server

This project's FastAPI app object lives in `backend/app/main.py` (`app = FastAPI(...)`), inside the `app` package — so the module path uvicorn needs is `app.main:app`, not a generic `app:app`.

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

What each part means:

| Part | Meaning |
|---|---|
| `app.main:app` | `app.main` = the module `backend/app/main.py`; `:app` = the `FastAPI()` instance defined there |
| `--host 0.0.0.0` | Listen on all network interfaces, not just `localhost` — required so the outside world (or Nginx, in Phase 13) can reach it |
| `--port 8000` | Matches the port opened in the Phase 5 security group ("FastAPI (testing only)") |

You should see output like:

```
INFO:     Started server process [1234]
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

**This command blocks your terminal** — it keeps running in the foreground until you press `Ctrl+C`. Closing the terminal or disconnecting SSH will stop the server too, since it isn't a background service yet.

## 3. Verify It's Reachable

From your **Mac**, in a plain **local Terminal tab (no SSH needed here — this is a normal network request to the instance's public IP, the same as visiting a website)**, replace `YOUR_PUBLIC_IP` with your instance's actual IP — same value as Phase 6, Step 1 (AWS Console → EC2 → Instances → your instance → **Public IPv4 address** on the Details tab). If you stopped/started the instance since then, re-check it — the IP may have changed:

```bash
curl http://YOUR_PUBLIC_IP:8000
```

Or open `http://YOUR_PUBLIC_IP:8000` directly in a browser. You should get a response from the API (even a `{"detail":"Not Found"}` JSON response for the root path is a good sign — it means FastAPI is running and answering requests; check `http://YOUR_PUBLIC_IP:8000/docs` for the interactive Swagger UI instead, if the app doesn't define a root route).

If this times out: double-check the Phase 5 security group still allows port `8000` from **My IP**, and that your current IP hasn't changed since then (Phase 6 mentions this same issue for port 22).

## 4. Stopping the Server

Back in the SSH session running uvicorn, press:

```
Ctrl + C
```

This is only for testing. **Later, replace this manual foreground process with a production service** (systemd or Docker), so FastAPI keeps running in the background and restarts automatically if the instance reboots — see Phase 13b.

---

# Phase 13 – Configure Nginx

Nginx acts as the reverse proxy in front of **two** separate running processes on this instance — this project's frontend is a Next.js app (not static files), so it needs its own running server alongside FastAPI:

```text
Internet
    │
    ▼
  Nginx (port 80/443)
    │
    ├── /health, /scan, /ocr, /history  →  FastAPI (uvicorn, port 8000)
    │
    └── everything else                 →  Next.js (port 3000)
```

Responsibilities:

* Serve the application on the standard web ports (80/443) instead of exposing 8000/3000 directly
* Route requests to the right backend process based on the URL path
* Handle HTTPS (Phase 15)
* Improve security by not exposing app servers directly to the internet

**Where to run these commands:** in your SSH session on EC2, unless noted otherwise.

## 1. Rebuild the Frontend for Same-Origin API Calls

The frontend currently calls the backend at `http://localhost:8000` by default (baked in at build time by Next.js). Once Nginx routes both under the same origin, the frontend should use relative paths instead, so it keeps working regardless of domain/IP. Rebuild with an empty API URL:

```bash
cd ~/cyber_scam_shield_assistant_ai/frontend
NEXT_PUBLIC_API_URL="" npm run build
```

This overwrites the build from Phase 9 with one where API calls go to relative paths like `/health` instead of `http://localhost:8000/health` — which Nginx will then route correctly in Step 3 below.

## 2. Start Both App Servers

Both need to be running as separate foreground processes for now (Phase 13b below replaces this with systemd services). Use two separate SSH sessions so each has its own terminal:

**SSH session 1 — FastAPI (as in Phase 12):**
```bash
cd ~/cyber_scam_shield_assistant_ai/backend
source venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**SSH session 2 — Next.js:**
```bash
cd ~/cyber_scam_shield_assistant_ai/frontend
npm run start -- -p 3000
```

You should see `▲ Next.js ... - Local: http://localhost:3000` in the output. Leave both sessions running.

## 3. Configure Nginx

Open a **third SSH session** for this (keep the two above running):

1. Edit Nginx's default site config:

   ```bash
   sudo nano /etc/nginx/sites-available/default
   ```

2. Replace the entire contents of the file with:

   ```nginx
   server {
       listen 80;
       server_name _;

       location /health {
           proxy_pass http://127.0.0.1:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }

       location /scan {
           proxy_pass http://127.0.0.1:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }

       location /ocr {
           proxy_pass http://127.0.0.1:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }

       location /history {
           proxy_pass http://127.0.0.1:8000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```

   This matches the app's actual backend route prefixes (`/health`, `/scan`, `/ocr`, `/history` — confirmed against `backend/app/api/routes/`); anything else falls through to the `location /` block, which sends it to Next.js.

3. Save and exit: `Ctrl + O`, `Enter`, `Ctrl + X`.

4. Test the config for syntax errors **before** reloading — this catches typos without risking downtime:

   ```bash
   sudo nginx -t
   ```

   You should see `syntax is ok` and `test is successful`. If not, fix the reported line before continuing.

5. Reload Nginx to apply the new config:

   ```bash
   sudo systemctl reload nginx
   ```

## 4. Verify

From your **Mac's local terminal** (no SSH):

```bash
curl http://YOUR_PUBLIC_IP/health
curl http://YOUR_PUBLIC_IP/
```

The first should return FastAPI's JSON health response; the second should return the Next.js homepage's HTML. Both going through plain port 80 (no `:8000` or `:3000` needed) confirms Nginx is routing correctly.

## 5. Notes

* Port 8000 in the Phase 5 security group was always labeled "testing only" — now that Nginx handles the public-facing traffic, you can tighten or remove that inbound rule later, since the app is reachable through port 80 instead.
* Both `uvicorn` and `npm run start` are still running in the foreground across two SSH sessions — closing either one takes that part of the app down. Turning these into background services (systemd) is covered in Phase 13b, immediately below.

## 6. Troubleshooting

* **`sudo cat /etc/nginx/sites-available/default` still shows the original commented-out placeholder content after editing.** The edit didn't actually save in `nano`. Redo the edit and make sure to press `Ctrl + O`, then `Enter` to confirm the filename, then `Ctrl + X` — verify with `sudo cat` again afterward before moving on.
* **`curl http://localhost/...` fails even on the instance itself, but `sudo systemctl status nginx` shows `active (running)`.** "Active" only means the process is up — it doesn't guarantee it's listening on the port you expect. Confirm with `sudo ss -tlnp | grep nginx`; if port 80 isn't listed, the loaded config has no `listen 80` in it (see the point above).
* **`curl http://localhost/health` works, but `http://YOUR_PUBLIC_IP/health` from your Mac times out.** This means Nginx itself is fine — it's a security group problem. A single EC2 instance can have **multiple security groups attached at once** (check the instance's **Security** tab, not just one group you happen to have open), and AWS combines all of their rules. Find whichever group actually controls inbound access (look for one with your SSH/22 rule) and confirm it also has rules for **80** (HTTP) and **443** (HTTPS) with source `0.0.0.0/0` — these are meant to be open to everyone, unlike SSH's "My IP" rule.
* **`curl` returns `502 Bad Gateway`** (as opposed to timing out or refusing the connection). Nginx is running and reachable, but the specific backend it's trying to proxy to (`127.0.0.1:8000` for FastAPI, or `127.0.0.1:3000` for Next.js) isn't responding — most likely that process died (e.g., its SSH session was closed or disconnected). Restart it the same way as Phase 12/13 Step 2, and recheck.

---

# Phase 13b – Run as systemd Services (Production)

Phases 12–13 ran `uvicorn` and `npm run start` as bare foreground processes in SSH sessions — fine for testing, but fragile: closing or losing either SSH session kills that process, and nginx then returns **502 Bad Gateway** for whatever it was proxying to (see Phase 13 §6 Troubleshooting). systemd fixes this: both processes run as background services that restart on crash and start automatically on instance reboot.

## 1. Stop the Manual Processes

If `uvicorn` or `npm run start` are still running in foreground SSH sessions from Phase 12/13, stop them first (`Ctrl+C` in each session, or from a separate session: `pkill -f 'uvicorn app.main:app'` / `pkill -f 'next start'`) so systemd can bind the same ports.

## 2. Create the Backend Service

```bash
sudo nano /etc/systemd/system/cyber-scam-backend.service
```

```ini
[Unit]
Description=Cyber Scam Shield Assistant AI - FastAPI backend
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/cyber_scam_shield_assistant_ai/backend
ExecStart=/home/ubuntu/cyber_scam_shield_assistant_ai/backend/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`WorkingDirectory` matters here, not just cosmetics — `backend/app/core/config.py` loads `.env` via a relative path (`pydantic-settings`'s `env_file=".env"`), so the service won't find its environment variables (e.g. `DATABASE_URL`) unless it starts from `backend/`. `ExecStart` points directly at the venv's `uvicorn` binary rather than `source venv/bin/activate`, since systemd doesn't run a shell that could source it.

## 3. Create the Frontend Service

```bash
sudo nano /etc/systemd/system/cyber-scam-frontend.service
```

```ini
[Unit]
Description=Cyber Scam Shield Assistant AI - Next.js frontend
After=network.target cyber-scam-backend.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/cyber_scam_shield_assistant_ai/frontend
ExecStart=/usr/bin/npm run start -- -p 3000
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Confirm the `npm` path matches your instance first (`which npm`) — it's normally `/usr/bin/npm` on the NodeSource-installed LTS from Phase 7, but systemd needs the absolute path either way.

## 4. Enable and Start Both

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cyber-scam-backend.service
sudo systemctl enable --now cyber-scam-frontend.service
```

`enable` makes both start automatically on every future boot, not just now; `--now` also starts them immediately. Check status and logs:

```bash
sudo systemctl status cyber-scam-backend.service
sudo systemctl status cyber-scam-frontend.service
sudo journalctl -u cyber-scam-backend.service -n 30 --no-pager
sudo journalctl -u cyber-scam-frontend.service -n 30 --no-pager
```

## 5. Verify

From your Mac:

```bash
curl http://YOUR_PUBLIC_IP/health
curl http://YOUR_PUBLIC_IP/
```

Both should return `200` with no SSH session needing to stay open.

## 6. Updating the Application Going Forward

After `git pull` on EC2 (see "Updating the Application" below), restart the relevant service instead of re-running the process manually:

```bash
sudo systemctl restart cyber-scam-backend.service
sudo systemctl restart cyber-scam-frontend.service
```

If the frontend changed, rebuild first (same as Phase 13 §1): `NEXT_PUBLIC_API_URL="" npm run build`, then restart the frontend service.

---

# Phase 14 – Configure Domain Name

(Optional)

Example:

```
www.cyberscamshield.ai
```

**Where these steps happen:** all in the **AWS Console**, signed in as the IAM Administrator user, except the final verification.

## 1. Allocate an Elastic IP First

Do this **before** pointing any domain at your instance. Your EC2 instance's public IP (`3.27.171.122`) changes every time it stops and restarts — we hit this repeatedly during earlier phases (SSH and the port 8000/80 checks kept failing after the IP silently changed). A DNS record pointing at that IP would break the same way. An **Elastic IP** is a static IP address you own and manually attach to the instance — it stays the same across stops/restarts.

1. Navigate to **EC2 → Network & Security → Elastic IPs**.
2. Click **Allocate Elastic IP address**.
3. Leave the default settings (Amazon's IPv4 address pool), then click **Allocate**.
4. Select the newly allocated address, then **Actions → Associate Elastic IP address**.
5. **Resource type** — select **Instance**.
6. **Instance** — select `cyber_scam_instance_prod`.
7. Click **Associate**.

Your instance's public IP is now fixed to this Elastic IP going forward — note it down, since it replaces `3.27.171.122` in every command elsewhere in this guide (SSH config, `curl` checks, etc.) if that IP changes as a result of this step.

**Cost note:** an Elastic IP is free while it's attached to a running instance. It only starts costing money if it's allocated but left **unattached**, or attached to a **stopped** instance — so don't allocate one you don't plan to actually use.

## 2. Get a Domain Name

If you don't already own a domain, register one through **Route 53** (AWS Console → Route 53 → Registered domains → Register domain) or a third-party registrar (**GoDaddy**, Namecheap, Google Domains, etc.) — either works the same for the DNS step below. This is a **paid** step (domains typically cost $10–20/year) — skip this entire phase if you're fine accessing the app by IP address for now.

**Note:** AWS blocks Route 53 domain registration on brand-new or Free Tier accounts as a fraud-prevention measure (`AccessDeniedException: Free Tier accounts are not supported for this service`). If you hit this, either open an AWS Support case to lift the restriction, or just use a third-party registrar instead — simpler, and often cheaper too.

## 3. Point the Domain at Your Elastic IP

**If you registered through Route 53:**

1. Navigate to **Route 53 → Hosted zones**, and select the hosted zone for your domain (created automatically if you registered it through Route 53).
2. Click **Create record**.
3. **Record name** — leave blank for the root domain (`cyberscamshield.ai`) or enter `www` for `www.cyberscamshield.ai`.
4. **Record type** — **A – Routes traffic to an IPv4 address**.
5. **Value** — enter your Elastic IP address from Step 1.
6. **TTL** — leave at the default (300 seconds).
7. Click **Create records**.

**If you registered through GoDaddy:**

1. Log in to GoDaddy → **My Products** → find your domain → click **DNS** (or **Manage DNS**).
2. In the **DNS Records** section, click **Add** (or edit the existing placeholder `A` record if GoDaddy created one automatically).
3. Set **Type**: `A`, **Name/Host**: `www` (or `@` for the bare root domain), **Value/Points to**: your Elastic IP from Step 1, **TTL**: default, or `300` seconds if you want faster iteration while testing.
4. Save.

**If you used a different third-party registrar:**

1. Log in to that registrar's dashboard and find its **DNS management** section (naming varies — "DNS Records," "Advanced DNS," etc.).
2. Add an **A record**: Host = `www` (or `@` for the root domain), Value = your Elastic IP address, TTL = default/automatic.
3. Save.

## 4. Wait for DNS Propagation

DNS changes aren't instant — they can take anywhere from a few minutes up to 48 hours to fully propagate, though it's usually much faster in practice. Check whether it's resolved yet from your Mac's local terminal:

```bash
dig www.cyberscamshield.ai +short
```

This should eventually print your Elastic IP address. If it prints nothing yet, the change hasn't propagated — wait a bit and try again.

## 5. Verify

Once `dig` returns the correct IP, test the actual app through the domain:

```bash
curl http://www.cyberscamshield.ai/health
```

This should return the same `{"status":"ok"}` response as the direct-IP check in Phase 13. If it times out even though `dig` resolves correctly, double-check the security group rules from Phase 13 (ports 80/443 open to `0.0.0.0/0`) — domain vs. IP access hits the same security group either way, so a working IP-based check ruling that out already helps narrow it down.

---

# Phase 15 – Enable HTTPS

Install Let's Encrypt using Certbot.

Benefits:

* Secure connection
* Trusted by browsers
* Better security

---

# Phase 16 – Monitoring

Enable CloudWatch.

Monitor:

* CPU
* Memory
* Disk usage
* Application logs
* Errors

---

# Phase 17 – Production Deployment

Application becomes publicly available.

Example:

```
https://www.cyberscamshield.ai
```

Congratulations!

Cyber Scam Shield Assistant AI is now deployed to AWS.

---

# Updating the Application

Future development should always happen locally.

Workflow:

```text
Mac

↓

Develop Feature

↓

Test

↓

git add

↓

git commit

↓

git push

↓

GitHub

↓

AWS EC2

↓

git pull

↓

Restart Application
```

Example:

On your Mac:

```bash
git add .

git commit -m "Added phishing detection"

git push origin main
```

On AWS:

```bash
cd cyber_scam_shield_assistant_ai

git pull origin main
```

Restart the application.

The new version is now live.

---

# Future Upgrades

## Version 1 (Current)

* GitHub
* EC2
* FastAPI
* React
* PostgreSQL (RDS)
* S3
* Manual deployment (`git pull`)

---

## Version 2

Automate deployments using GitHub Actions.

```text
Mac

↓

git push

↓

GitHub

↓

GitHub Actions

↓

AWS EC2

↓

Automatic Deployment
```

Benefits:

* No manual SSH
* Faster deployments
* Reduced human error

---

## Version 3

Containerize the application.

Technologies:

* Docker
* Amazon ECS
* Amazon ECR

Benefits:

* Easier scaling
* Consistent environments
* Better resource management

---

## Version 4

Production-ready architecture.

Add:

* Application Load Balancer (ALB)
* Auto Scaling
* CloudFront
* AWS WAF
* Secrets Manager
* CI/CD Pipeline
* Multi-AZ RDS
* Automated Backups
* CloudWatch Alarms

Suitable for:

* Thousands of users
* High availability
* Enterprise-grade deployments

---

# Best Practices

* Develop locally.
* Test locally.
* Commit frequently.
* Push changes to GitHub.
* Never edit production code directly on EC2.
* Keep secrets in environment variables or AWS Secrets Manager.
* Back up the database regularly.
* Monitor the application using CloudWatch.
* Start simple and improve the architecture over time.

---

# Deployment Philosophy

> Build locally.
>
> Test locally.
>
> Deploy confidently.
>
> Automate when ready.
>
> Scale only when necessary.



# NOTES


Public IPv4 : 3.27.171.122
Pulic IPv4 DNS :ec2-3-27-171-122.ap-southeast-2.compute.amazonaws.com



ssh -i cyber_scam_shield_key.pem ubuntu@3.27.171.122


Host cyber_scam_shield_key
    HostName 3.27.171.122
    User ubuntu
    IdentityFile ~/.ssh/cyber_scam_shield_key.pem


RDS Password: <redacted — see password manager, not stored in this repo>


cyber-scam-shield-db.c7camega8ij8.ap-southeast-2.rds.amazonaws.com


DATABASE_URL=postgresql+psycopg2://postgres:your-strong-password@cyber-scam-shield-db.xxxxxxxxxx.ap-southeast-2.rds.amazonaws.com:5432/postgres


aws s3 ls s3://cyber-scam-shield-uploads-bucket


curl http://3.27.171.122:8000


ssh cyber_scam_shield_key

curl http://3.27.171.122/health

curl http://3.27.171.122/


RDS Pass: <redacted — see password manager, not stored in this repo>
