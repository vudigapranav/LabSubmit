# CBIT College Programming Laboratory Management Platform

An enterprise-grade, full-stack **College Programming Laboratory Management & Code Execution Platform** designed specifically for **Chaitanya Bharathi Institute of Technology (CBIT)**. 

Built with **Next.js (App Router, TypeScript)**, **Tailwind CSS**, **Prisma ORM**, **Monaco Editor**, and a **Native Multi-Language Compiler Engine (C, C++, Java, JavaScript)**.

---

## 📋 Table of Contents
1. [Project Overview](#1-project-overview)
2. [Folder Structure](#2-folder-structure)
3. [Software Prerequisites](#3-software-prerequisites)
4. [Installation Guide](#4-installation-guide)
5. [Environment Variables](#5-environment-variables)
6. [Database Setup & Seeding](#6-database-setup--seeding)
7. [Running the Application](#7-running-the-application)
8. [Online Compiler Engine Setup](#8-online-compiler-engine-setup)
9. [Troubleshooting & Common Fixes](#9-troubleshooting--common-fixes)
10. [Production Deployment Guide](#10-production-deployment-guide)

---

## 1. Project Overview

The CBIT Laboratory Management Platform provides a role-based environment for managing computer science laboratory courses, student roll number allocations, assessment submissions, and automated code execution.

### Key Roles & Functionality

#### 🛡️ System Administrator (`admin@cbit.in` / `admin@123`)
- **Faculty Management**: Create lecturer accounts (`username@cbit.in`), edit details, set student capacity limits, delete faculty, and reset passwords.
- **Roll Number Allocation**: Define authorized student Roll Number ranges (e.g., `160125000001` to `160125000120`) and assign them to specific lecturers.
- **Registered Students Inspection**: View all registered students across departments, automatically sorted by Roll Number in ascending order.
- **System Metrics & Evaluation Reports**: View total submissions, grading completion rates, and performance statistics across faculty members.

#### 🏫 Faculty Lecturer (`username@cbit.in`)
- **Year & Section Management**: Create, rename, edit, and delete sections for 1st, 2nd, 3rd, and 4th-year students (e.g., `CSE-1`, `CSE-2`, `CIC-1`).
- **Student View**: View enrolled section students, always sorted by Roll Number ascending.
- **Lab Assessment Authoring**: Create lab tasks, write problem statements, set due dates, and specify input/output constraints.
- **Submission Viewer & Code Runner**: Inspect multi-file student code submissions, execute student code live, and download source files.
- **Evaluation & Grading**: Award marks (0–100), write feedback remarks, set evaluation status (`APPROVED`, `REJECTED`, `NEEDS_CORRECTION`), reopen workspaces for student corrections, and toggle instant grade publishing.

#### 🎓 Student (`Roll Number` + Password)
- **Controlled Self-Registration**: Registration requires a valid 12-digit `1601XXXXXXXX` Roll Number within an Admin-authorized range. Prevents duplicate registrations and filters out full faculty members.
- **Monaco Online IDE**: Tabbed multi-file editor with syntax highlighting for C (`.c`), C++ (`.cpp`), Java (`.java`), and JavaScript (`.js`).
- **Anti-Cheat Protection**: Suppresses copy, paste, cut, context menu (right click), keyboard shortcuts (`Ctrl+C`, `Ctrl+V`, `Ctrl+X`, `Shift+Insert`), and drag-and-drop text transfers.
- **Single Submission Locking**: Workspaces lock read-only upon submission unless reopened by the lecturer.
- **Real-Time Grade View**: Access published marks, evaluation status, and faculty remarks immediately.

---

## 2. Folder Structure

```
LabSubmit/
├── Dockerfile                      # Production Docker container definition
├── docker-compose.yml              # Production Docker Compose stack
├── package.json                    # Project dependencies & scripts
├── tsconfig.json                   # TypeScript compiler configuration
├── tailwind.config.js              # Custom theme tokens (Olive Green & Blue)
├── postcss.config.js               # PostCSS configuration
├── next.config.mjs                 # Next.js build setup
├── .env                            # Environment variables (Database & JWT)
├── README.md                       # Complete production documentation
├── prisma/
│   ├── schema.prisma               # Relational database schema
│   └── seed.ts                     # Database initialization script
├── public/
│   └── cbit-logo.png               # Official CBIT logo asset
└── src/
    ├── app/
    │   ├── layout.tsx              # Root HTML layout & AppProvider wrapper
    │   ├── page.tsx                # Institutional landing page
    │   ├── globals.css             # Global styles & theme CSS variables
    │   ├── login/
    │   │   └── page.tsx            # Unified login portal (Student/Lecturer/Admin)
    │   ├── register/
    │   │   └── page.tsx            # Student self-registration page
    │   ├── admin/
    │   │   └── page.tsx            # Administrator control panel
    │   ├── lecturer/
    │   │   └── page.tsx            # Faculty lecturer workspace & grading drawer
    │   ├── student/
    │   │   ├── page.tsx            # Student dashboard & lab status
    │   │   └── lab/[id]/
    │   │       └── page.tsx        # Online IDE lab assessment page
    │   └── api/
    │       ├── admin/              # Admin APIs (lecturers, ranges, stats, students)
    │       ├── auth/               # Auth APIs (login, register, me, available lecturers)
    │       ├── compile/run/        # Real multi-language execution API
    │       ├── lecturer/           # Lecturer APIs (sections, labs, submissions, evaluate)
    │       ├── profile/            # Profile & theme persistence APIs
    │       └── student/            # Student APIs (labs, workspace, grades)
    ├── components/
    │   ├── Navbar.tsx              # CBIT Header with theme toggle & user badge
    │   ├── OnlineIDE.tsx           # Monaco Code Editor & Terminal output panel
    │   ├── AntiCheatWrapper.tsx    # Anti-cheat event interceptor
    │   └── ProfileModal.tsx        # Account settings & password change modal
    ├── context/
    │   └── AppContext.tsx          # Global authentication & theme state manager
    └── lib/
        ├── db.ts                   # Prisma Client singleton
        ├── jwt.ts                  # JWT token signing & verification
        ├── auth.ts                 # Role-based API route guard middleware
        └── compiler.ts             # Native C/C++/Java/JS code execution engine
```

---

## 3. Software Prerequisites

Before installing and running the application, ensure the following software tools are installed on your machine:

| Software | Required Version | Purpose | Command to Check |
|---|---|---|---|
| **Node.js** | v18.0.0+ or v20.0.0+ | JavaScript runtime environment | `node -v` |
| **npm** | v9.0.0+ or v10.0.0+ | Node package manager | `npm -v` |
| **GCC** | Any recent version | C compiler (`gcc`) | `gcc --version` |
| **G++** | Any recent version | C++ compiler (`g++`) | `g++ --version` |
| **Java JDK** | OpenJDK 11+ or 17+ | Java compiler (`javac`) & runtime (`java`) | `javac -version` |
| **PostgreSQL** *(Optional)* | v14+ or v15+ | Relational database (SQLite used by default for zero setup) | `psql --version` |
| **Docker** *(Optional)* | v20+ | Containerized production deployment | `docker --version` |

---

## 4. Installation Guide

Follow these commands step-by-step to set up the codebase on your machine.

### Step 1: Open Terminal & Navigate to Project Directory
```bash
cd /path/to/LabSubmit
```

### Step 2: Install Project Dependencies
Run the package installation command:
```bash
npm install
```

---

## 5. Environment Variables

Create a file named `.env` in the root directory of the project (same directory as `package.json`).

```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="cbit-labsubmit-super-secret-jwt-key-2026"
NODE_ENV="development"
PORT=3000
```

### Explanation of Environment Variables

- `DATABASE_URL`: Connection string for Prisma ORM. Defaults to SQLite (`file:./dev.db`) for zero-configuration local execution. For PostgreSQL production, set:
  `DATABASE_URL="postgresql://username:password@localhost:5432/cbit_labsubmit?schema=public"`
- `JWT_SECRET`: Secret key used to sign and verify JSON Web Tokens for authentication.
- `NODE_ENV`: Application environment state (`development` or `production`).
- `PORT`: Network port on which the Next.js server listens (default: `3000`).

---

## 6. Database Setup & Seeding

The platform uses Prisma ORM. Follow these steps to synchronize the database schema and initialize the System Administrator account.

### Step 1: Push Database Schema
Synchronize the Prisma DSL schema with the database file:
```bash
npx prisma db push
```

### Step 2: Generate Prisma Client
Build the type-safe Prisma client:
```bash
npx prisma generate
```

### Step 3: Seed Database (Fresh Installation)
Initialize the system with the single System Administrator account:
```bash
npm run db:seed
```

> [!IMPORTANT]
> **Initial System Administrator Credentials:**
> - **Email**: `admin@cbit.in`
> - **Password**: `admin@123`
>
> The database is initialized cleanly without dummy lecturers or students. Log in as Admin to create lecturers, roll number ranges, and sections.

---

## 7. Running the Application

### Running in Development Mode
To start the local development server with hot-reloading:

```bash
npm run dev
```

1. Open your browser and navigate to: `http://localhost:3000`
2. Terminal output will confirm: `▲ Next.js 14.2.10 - Local: http://localhost:3000`

### Running in Production Mode
To test the optimized production build locally:

```bash
# Build the production bundle
npm run build

# Start the production server
npm start
```

---

## 8. Online Compiler Engine Setup

The platform features a **native multi-language code execution engine**. It compiles and runs student code directly using compilers installed on your operating system.

### Language Compiler Mapping
- `.c` extension $\rightarrow$ `gcc -O2 source.c -o a.out -lm`
- `.cpp` / `.cc` extension $\rightarrow$ `g++ -O2 source.cpp -o a.out -std=c++17`
- `.java` extension $\rightarrow$ `javac Main.java` followed by `java -cp . Main`
- `.js` extension $\rightarrow$ `node main.js`

### Operating System Compiler Setup Guide

#### On Ubuntu / Debian Linux:
```bash
sudo apt update
sudo apt install -y build-essential openjdk-17-jdk nodejs
```

#### On macOS:
```bash
# Install Xcode Command Line Tools for gcc and g++
xcode-select --install

# Install Java JDK via Homebrew if needed
brew install openjdk
```

#### On Windows:
1. Install **MinGW-w64** (or GCC via MSYS2) and add its `bin` directory to your System PATH environment variable.
2. Install **OpenJDK** (version 17+) and add `javac` / `java` to System PATH.
3. Install **Node.js** (v20+).

### Execution Timeout & Process Isolation
- Executed programs run in isolated temporary workspace directories (`/tmp/labsubmit_exec_...`).
- Processes are capped at a **5-second execution timeout** (`SIGKILL`) to kill infinite loops.
- Temporary files are automatically purged after execution.

---

## 9. Troubleshooting & Common Fixes

### Issue 1: `Port 3000 is already in use`
**Cause**: Another process or previous dev server is using port 3000.  
**Solution**:
- On Linux/macOS: Run `lsof -i :3000` and kill the PID with `kill -9 <PID>`.
- Or specify a different port in `.env`: `PORT=3001` or run `PORT=3001 npm run dev`.

### Issue 2: `PrismaClientKnownRequestError` or SQLite Database Lock
**Cause**: Database file is corrupted or opened by another process.  
**Solution**: Reset and re-seed the database:
```bash
npx prisma db push --force-reset
npm run db:seed
```

### Issue 3: `gcc` / `g++` / `javac` is not recognized as an internal or external command
**Cause**: C, C++, or Java compilers are not installed or not in your system's PATH.  
**Solution**: Install GCC, G++, and Java OpenJDK as outlined in [Section 8](#8-online-compiler-engine-setup) and ensure their binary directories are listed in system PATH.

### Issue 4: `Module not found` or Missing Node Packages
**Cause**: Dependencies were not fully installed.  
**Solution**: Clean node_modules and re-install:
```bash
rm -rf node_modules package-lock.json
npm install
```

### Issue 5: `JWT_SECRET is undefined` or Authentication Failure
**Cause**: `.env` file is missing or not placed in the root directory.  
**Solution**: Ensure `.env` exists in the same folder as `package.json` with `JWT_SECRET` defined.

---

## 10. Production Deployment Guide

### Deployment via Docker Compose (Recommended for Production)

The repository includes a production `Dockerfile` and `docker-compose.yml`.

```bash
# 1. Build and start the container in detached mode
docker-compose up -d --build

# 2. Push database schema inside the container
docker-compose exec app npx prisma db push

# 3. Seed initial Admin account inside the container
docker-compose exec app npm run db:seed

# 4. Check container status
docker-compose ps
```

The application will be accessible at `http://your-server-ip:3000`.

---

## 🎓 License & Ownership

Developed for **Chaitanya Bharathi Institute of Technology (CBIT)**. All rights reserved.
