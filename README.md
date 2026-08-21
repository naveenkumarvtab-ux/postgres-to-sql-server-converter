# Database Migration Converter: User & Setup Guide

This application is a powerful, automated migration assistant that translates database schemas and DDL objects (Schemas, Tables, Views, Stored Procedures, Functions, Triggers, Indexes, and Sequences) from **PostgreSQL**, **MySQL**, and **Oracle** into **Microsoft SQL Server (T-SQL)** compatibility. It also enables direct deployment to your SQL Server instance and exports schema backups (`.BAK`).

---

## 📋 Prerequisites

Before running the application, make sure you have the following installed on your machine:

### 1. Node.js
- **Required Version**: `20.19+` or `22.12+` (Vite 8 requirement).
- [Download Node.js](https://nodejs.org/)

### 2. Microsoft SQL Server
You can connect to any of the following editions:
- **SQL Server Express** (Free, lightweight)
- **SQL Server Developer Edition** (Free for development, full-featured)
- **SQL Server Standard/Enterprise**
- *Note*: Ensure **SQL Server Authentication** is enabled if you plan to connect using username/password.

### 3. ODBC Driver for SQL Server
- The application uses `msnodesqlv8` under the hood to support both Windows Integrated Authentication (Active Directory) and SQL Server Authentication.
- **Required**: [ODBC Driver 17 for SQL Server](https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server) (installed by default with SQL Server Management Studio - SSMS).

---

## 🚀 Getting Started & Running

Follow these steps to set up and start the application:

### Step 1: Install Dependencies
Open your terminal (PowerShell, Command Prompt, or bash) in the project root directory and run:
```bash
npm install
```

### Step 2: Start the Application
Run the concurrent development command which launches both the React/Vite frontend and the Express backend:
```bash
npm run dev:full
```

### Step 3: Access the Interface
Once the console shows that Vite is ready, open your browser and navigate to:
- 👉 **[http://localhost:5173/](http://localhost:5173/)**
- (If localhost doesn't resolve due to IPv6 loopback settings on Windows, use: **[http://127.0.0.1:5173/](http://127.0.0.1:5173/)**)

---

## ⚙️ Connection & Settings Guide

Click on the **"Open Settings"** or gear icon button in the UI header to configure the application.

### 1. Database Connection Configuration

Below are examples of how to fill out the SQL Server connection form based on your setup:

#### Option A: Local SQL Server Express (SQL Server Authentication)
- **Server/Host**: `localhost\SQLEXPRESS` (or `127.0.0.1\SQLEXPRESS`)
- **Port**: `1433` (default TCP port)
- **User**: `sa`
- **Password**: `your_sa_password`
- **Database**: `master` (used as the initial connection to create disposable migration databases)
- **Use Trusted Connection**: **Disabled** (unchecked)

#### Option B: Local Developer Edition (Windows Authentication / Trusted)
- **Server/Host**: `localhost` (or `.` / `localhost\MSSQLSERVER`)
- **Port**: `1433`
- **User**: *(Leave blank)*
- **Password**: *(Leave blank)*
- **Database**: `master`
- **Use Trusted Connection**: **Enabled** (checked)
  - *Note*: This logs you in using your current Windows logged-in user credentials.

#### Option C: Remote SQL Server instance
- **Server/Host**: `192.168.1.100` (or `sql-prod.company.local`)
- **Port**: `1433`
- **User**: `migration_user`
- **Password**: `secure_password`
- **Database**: `master`
- **Use Trusted Connection**: **Disabled**

---

## 🛠️ Troubleshooting Connection Issues

If the application displays a **"Connection Failed"** banner, check the following in order:

### 1. Enable TCP/IP Protocol (Crucial for Local SQL Server)
By default, SQL Server Express disables TCP/IP connections.
1. Open the **SQL Server Configuration Manager**.
2. Expand **SQL Server Network Configuration** ➔ Click **Protocols for SQLEXPRESS** (or your instance name).
3. Right-click **TCP/IP** and select **Enable**.
4. Double-click **TCP/IP**, select the **IP Addresses** tab, scroll to the bottom, and make sure **TCP Port** under **IPAll** is set to `1433`.
5. Restart the **SQL Server Service** in the services console.

### 2. Verify Authentication Mode
If connecting via `sa` user fails, ensure Mixed Mode Authentication is active:
1. Open **SQL Server Management Studio (SSMS)**.
2. Right-click the server node ➔ **Properties** ➔ **Security**.
3. Set **Server authentication** to **SQL Server and Windows Authentication mode**.
4. Restart SQL Server.

---

## 🧠 Advanced Translation Settings

### 1. Gemini API Key
- **Purpose**: Translates complex procedural logic (PL/SQL blocks, triggers, packages, and custom stored procedures) from Oracle, Postgres, and MySQL.
- **Setup**: Obtain a free API key from Google AI Studio and paste it in the settings modal.
- If no key is configured, the tool will still translate tables, constraints, indexes, and sequences at 100%, and flag procedural blocks as `PENDING AI TRANSLATION` so you can manually review them.

### 2. Target SQL Server Version
- **2017+ (Default)**: Leverages modern T-SQL functions (like native `CONCAT_WS`, `STRING_AGG`, etc.).
- **2016 & Lower**: Automatically converts modern functions into safe fallback combinations (e.g., simulating `CONCAT_WS` using `STUFF` and `COALESCE` concatenations).

---

## 👥 Contributors

- **Naveenkumar**
- **Aakaash padhmanaban**