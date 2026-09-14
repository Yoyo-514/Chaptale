/** 心跳间隔：一分钟一次。判断“到点没有”靠短心跳，而不是挂一个长达一天的长定时器——
 * 长定时器在系统休眠、唤醒、时间被改动之后会漂，而心跳每次都拿当前时间重算。 */
const TICK_INTERVAL_MS = 60_000;

/**
 * 这次心跳该不该自动备份。
 *
 * 收成一个纯函数是为了能把边界逐个钉住：间隔是唯一的节奏参数，其余几项都是“现在不适合”的理由。
 * 注意它**不判断登录与绑定**——那些是执行侧的门槛（`createBackup` 自己会拒），这里重复一遍
 * 只会有两处迟早对不上的规则。
 */
export function shouldAutoBackup(input: {
  now: Date;
  /** 本机上次**成功**备份的时间；从没备过就是 null。 */
  lastBackupAt: string | null;
  intervalMinutes: number;
  /** 已有备份/恢复在跑：这一轮跳过，不排队。 */
  busy: boolean;
}): boolean {
  if (input.busy) return false;

  const previous = input.lastBackupAt ? Date.parse(input.lastBackupAt) : Number.NaN;

  // 从没备过、或时间读不出来（手改坏的记录）：该备，而不是一直等着一个不存在的起点。
  if (Number.isNaN(previous)) return true;

  return input.now.getTime() - previous >= input.intervalMinutes * 60_000;
}

/**
 * 自动备份的心跳。
 *
 * 它只负责“按时敲一下”，判断与执行都在 `CloudSyncService.autoBackupTick` 里：
 * 定时器不持有业务规则，就不会出现“界面关着时定时器按另一套逻辑跑”的分叉。
 */
export function createAutoBackupScheduler(input: { tick: (now: Date) => Promise<void>; intervalMs?: number }): {
  start: () => void;
  stop: () => void;
} {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const beat = async () => {
    // 上一拍还没跑完就跳过这一拍：备份是整包上传，重叠只会浪费带宽。
    if (running) return;

    running = true;

    try {
      await input.tick(new Date());
    } catch {
      // 心跳自己不能把主进程带下去：失败已经由 tick 内部记进绑定记录。
    } finally {
      running = false;
    }
  };

  return {
    start() {
      if (timer) return;

      timer = setInterval(() => void beat(), input.intervalMs ?? TICK_INTERVAL_MS);
      // 不让定时器拖住进程退出：它的存在只为在应用活着的时候敲拍。
      timer.unref?.();
    },
    stop() {
      if (!timer) return;

      clearInterval(timer);
      timer = null;
    }
  };
}
