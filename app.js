const SUPABASE_URL = "https://lekspilvezepmyotpqaj.supabase.co"; // e.g. https://YOUR-PROJECT.supabase.co
const SUPABASE_ANON_KEY = "sb_publishable_i25IodSkGj123-iLtzHt-w_JHAiuxLU"; // Project Settings -> API -> anon/public key

const logoutButton = document.getElementById("logout-btn");
const userEmail = document.getElementById("user-email");

const taskForm = document.getElementById("task-form");
const taskNameInput = document.getElementById("task-name");
const taskIntervalInput = document.getElementById("task-interval");
const taskUnitInput = document.getElementById("task-unit");
const taskCount = document.getElementById("task-count");
const appStatus = document.getElementById("app-status");
const taskList = document.getElementById("task-list");
const emptyState = document.getElementById("empty-state");
const itemTemplate = document.getElementById("task-item-template");

const dayMs = 24 * 60 * 60 * 1000;

let supabaseClient = null;
let currentUser = null;
let tasks = [];

bootstrap();

async function bootstrap() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    window.location.replace("login.html");
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data } = await supabaseClient.auth.getSession();

  if (!data.session?.user) {
    window.location.replace("login.html");
    return;
  }

  currentUser = data.session.user;
  userEmail.textContent = currentUser.email || "Logged in";

  bindEvents();
  await loadTasks();

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    if (!session?.user) {
      window.location.replace("login.html");
    }
  });
}

function bindEvents() {
  logoutButton.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.replace("login.html");
  });

  taskUnitInput.addEventListener("change", () => {
    const isOneTime = taskUnitInput.value === "once";
    taskIntervalInput.disabled = isOneTime;
    if (isOneTime) {
      taskIntervalInput.value = "1";
    }
  });

  taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = taskNameInput.value.trim();
    const interval = Number(taskIntervalInput.value);
    const unit = taskUnitInput.value;

    if (!name || interval < 1 || !["once", "day", "week", "month"].includes(unit)) {
      setStatus("Please enter valid task details.");
      return;
    }

    const { error } = await supabaseClient.from("recurring_tasks").insert({
      id: crypto.randomUUID(),
      user_id: currentUser.id,
      name,
      interval,
      unit,
      last_completed_at: null,
      created_at: new Date().toISOString(),
    });

    if (error) {
      setStatus(humanizeDbError(error, "Could not add task."));
      return;
    }

    taskForm.reset();
    taskIntervalInput.value = "1";
    taskUnitInput.value = "day";
    taskIntervalInput.disabled = false;
    taskNameInput.focus();
    setStatus("Task added.");
    await loadTasks();
  });
}

async function loadTasks() {
  const { data, error } = await supabaseClient
    .from("recurring_tasks")
    .select("id,name,interval,unit,last_completed_at,created_at")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    setStatus(humanizeDbError(error, "Could not load tasks."));
    return;
  }

  tasks = data.map((task) => ({
    id: task.id,
    name: task.name,
    interval: Number(task.interval),
    unit: task.unit,
    lastCompletedAt: task.last_completed_at,
    createdAt: task.created_at,
  }));

  renderTasks();
}

function renderTasks() {
  taskList.innerHTML = "";
  emptyState.style.display = tasks.length ? "none" : "block";
  taskCount.textContent = `${tasks.length} task${tasks.length === 1 ? "" : "s"}`;

  for (const task of tasks) {
    const node = itemTemplate.content.firstElementChild.cloneNode(true);
    const isOneTimeDone = task.unit === "once" && Boolean(task.lastCompletedAt);

    node.querySelector(".task-title").textContent = task.name;
    node.querySelector(".task-meta").textContent = getTaskMeta(task);
    node.querySelector(".task-next").textContent = getNextDueText(task);

    const completeBtn = node.querySelector(".complete-btn");
    completeBtn.disabled = isOneTimeDone;
    completeBtn.textContent = isOneTimeDone ? "Completed" : "Mark complete";

    completeBtn.addEventListener("click", async () => {
      if (isOneTimeDone) {
        return;
      }

      const { error } = await supabaseClient
        .from("recurring_tasks")
        .update({ last_completed_at: new Date().toISOString() })
        .eq("id", task.id)
        .eq("user_id", currentUser.id);

      if (error) {
        setStatus(humanizeDbError(error, "Could not update task."));
        return;
      }

      setStatus("Task marked complete.");
      await loadTasks();
    });

    node.querySelector(".delete-btn").addEventListener("click", async () => {
      const { error } = await supabaseClient.from("recurring_tasks").delete().eq("id", task.id).eq("user_id", currentUser.id);

      if (error) {
        setStatus(humanizeDbError(error, "Could not delete task."));
        return;
      }

      setStatus("Task deleted.");
      await loadTasks();
    });

    taskList.appendChild(node);
  }
}

function getTaskMeta(task) {
  if (task.unit === "once") {
    return "One-time task";
  }

  return `Repeats every ${task.interval} ${task.unit}${task.interval > 1 ? "s" : ""}`;
}

function getNextDueText(task) {
  if (task.unit === "once") {
    return task.lastCompletedAt ? "Status: Completed" : "Status: Pending";
  }

  return `Next due: ${formatDate(calculateNextDueDate(task))}`;
}

function calculateNextDueDate(task) {
  const baseDate = task.lastCompletedAt ? new Date(task.lastCompletedAt) : new Date(task.createdAt);
  const nextDate = new Date(baseDate);

  if (task.unit === "day") {
    nextDate.setTime(nextDate.getTime() + task.interval * dayMs);
  } else if (task.unit === "week") {
    nextDate.setTime(nextDate.getTime() + task.interval * 7 * dayMs);
  } else {
    nextDate.setMonth(nextDate.getMonth() + task.interval);
  }

  return nextDate;
}

function formatDate(date) {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function humanizeDbError(error, fallback) {
  const text = `${error.message || ""} ${error.details || ""}`.toLowerCase();

  if (text.includes("check") && text.includes("unit")) {
    return "Database schema needs update: allow unit values ('once','day','week','month') in recurring_tasks.";
  }

  return fallback;
}

function setStatus(message) {
  appStatus.textContent = message;
}
