export class MinIntervalQueue {
    private minInterval = 300;

    private currentTask: (() => Promise<void>) | null = null;

    private items: (() => Promise<void>)[] = [];

    // 队列状态，记录是否已经销毁，销毁需要取消递归等等
    private status: 'normal' | 'destory' = 'normal';

    constructor(minInterval: number) {
        this.minInterval = minInterval;
    }

    addTask(task: () => Promise<void>) {
        this.items.push(task);

        if (!this.currentTask) {
            return this.execute();
        }
    }

    // 执行任务
    private async execute() {
        if (this.status === 'destory') {
            return;
        }

        if (this.items.length) {
            this.currentTask = this.items.shift()!;

            try {
                this.currentTask();
                await sleep(this.minInterval);
            } catch (e) {
                console.log(e);
            } finally {
                this.currentTask = null;
            }
            // 任务之间的间隔

            this.execute();
        }
    }


    stopAndDestory() {
        this.status = 'destory';
        this.items = [];
        this.currentTask = null;
    }
}


interface Task { key: string; func: () => Promise<void> }

export class ConcurrencyTaskQueue {

    // 队列允许的并发数量 默认为3
    private allowConcurrencyCapacity = 3;

    // 补充的并发数量 默认为2 （当队列执行满了时，但等待队列中等待超过阈值后，将执行中的数据塞入补充队列，原当前队列接受等待中的任务）
    private supplementalCapacity = 2;

    // 等待多少秒后，使用补充的并发任务容量 默认3s
    private useSupplmentalWaitingTime = 3000;

    // 如果任务已经在队列中存在，则取消加入
    private noRepeat = true;

    // 虽然是并发，但执行时，任务之间需要有最小间隔
    private processingMinInterval = 0;

    // 最小间隔队列
    private minIntervalQueue: MinIntervalQueue = new MinIntervalQueue(0);

    private supplyWaitingTimer = 0;

    // 等待中的队列
    private waitingQueue: Task[] = [];

    // 主执行中的队列
    private mainProcessingQueue: Task[] = [];

    // 补充执行中的队列，如果主执行中的队列满了，等待的任务过了阈值，会把主执行中的任务转移到这里
    private supplementProcessingQueue: Task[] = [];

    // 执行完成的key
    private historyKeys: string[] = [];

    // 队列状态，记录是否已经销毁，销毁需要取消递归等等
    private status: 'normal' | 'destory' = 'normal';

    get isQueueDestory() {
        return this.status === 'destory';
    }

    get allProcessingTasks() {
        return [...this.supplementProcessingQueue, ...this.mainProcessingQueue];
    }

    /**
     * 
     * @param options 
     * @param options.allowConcurrencyCapacity 队列允许的并发数量
     * @param options.supplementalCapacity 补充的并发数量
     * @param options.useSupplmentalWaitingTime 等待多少秒后，使用补充的并发任务容量
     * @param options.noRepeat 如果任务已经在队列中存在，是否取消加入
     * @param options.noRepeat 虽然是并发，但执行时，任务之间需要有最小间隔
     */
    constructor(options: {
        allowConcurrencyCapacity: number;
        supplementalCapacity: number;
        useSupplmentalWaitingTime: number;
        noRepeat: boolean;
        processingMinInterval: number;
    }) {
        const { allowConcurrencyCapacity, supplementalCapacity, useSupplmentalWaitingTime, noRepeat, processingMinInterval } = options;
        this.allowConcurrencyCapacity = allowConcurrencyCapacity;
        this.supplementalCapacity = supplementalCapacity;
        this.useSupplmentalWaitingTime = useSupplmentalWaitingTime;
        this.noRepeat = noRepeat;
        this.processingMinInterval = processingMinInterval;
        this.minIntervalQueue = new MinIntervalQueue(this.processingMinInterval);
    }

    getHistoryKeys(){
        return this.historyKeys;
    }

    // 移除等待中的任务
    removeWaitingTaskNotInKeys(keys: string[]) {
        spliceBy(this.waitingQueue, (v) => !keys.includes(v.key));
    }

    stopAndDestory() {
        this.status = 'destory';
        this.waitingQueue = [];
        this.supplementProcessingQueue = [];
        this.mainProcessingQueue = [];
        if (this.supplyWaitingTimer) {
            window.clearTimeout(this.supplyWaitingTimer);
            this.supplyWaitingTimer = 0;
        }
        this.minIntervalQueue.stopAndDestory();
    }

    addTask(task: Task) {
        if (this.status === 'destory') {
            return;
        }
        
        if (this.noRepeat) {
            // 正在处理中or等待处理中则不重复添加
            const isRepeat = [...this.allProcessingTasks, ...this.waitingQueue].some(v => v.key === task.key);
            if (isRepeat) {
                return;
            }
        }

        this.waitingQueue.push(task);

        this.execute();
    }

    // 执行等待队列中的任务
    private async execute() {
        if (this.status === 'destory') {
            return;
        }

        const mainProcessingTaskCount = this.mainProcessingQueue.length;
        const waitingTaskCount = this.waitingQueue.length;
        
        if (!waitingTaskCount) return;
        
        // 当前主队列中的任务少于并发容量时，直接执行
        if (mainProcessingTaskCount < this.allowConcurrencyCapacity) {
            // 从等待队列中弹出
            const item = this.waitingQueue.shift()!;
            // 加入当前执行中的队列中
            this.mainProcessingQueue.push(item);

            // 如果有等待触发补充队列的话，直接取消，直接进入主队列
            if (this.supplyWaitingTimer) {
                window.clearTimeout(this.supplyWaitingTimer);
                this.supplyWaitingTimer = 0;
            }

            // 还有队列中有等待的任务 但主任务队列已经满了。触发补位
            if (this.waitingQueue.length > 0 && this.mainProcessingQueue.length >= this.allowConcurrencyCapacity) {
                this.handleSupplyQueue();
            }

            this.minIntervalQueue.addTask(async () => {
                try {
                    await item.func();
                } catch(e) {
                    console.log(e);
                }
    
                // 当前执行完成后删除任务 (不确定在主任务队列还是补充的，都需要检查一遍)
                spliceBy(this.mainProcessingQueue, (v) => v.key === item.key);
                spliceBy(this.supplementProcessingQueue, (v) => v.key === item.key);
                // 记录key
                this.historyKeys.push(item.key);
    
                this.execute();
            });
        }
        
        // 任务超过并发容量时，进入继续等待
    }

    handleSupplyQueue() {
        // 检查是否已经有任务在等待补充队列了 有的话，不处理
        if (!this.supplyWaitingTimer) {
            this.supplyWaitingTimer = window.setTimeout(() => {
                this.supplyWaitingTimer = 0;
                // 补充队列数量够的话，将主队列的任务移动至此
                if (this.supplementProcessingQueue.length < this.supplementalCapacity) {
                    const processingItem = this.mainProcessingQueue.shift();
                    if (processingItem) {
                        this.supplementProcessingQueue.push(processingItem);
                        // 执行等待中的任务
                        this.execute();
                    }
                }
            }, this.useSupplmentalWaitingTime);
        }
    }

}

/**
 * 根据传入的判断条件，从数组中删除元素 会改变原数组 (调用当前数组上的splice 不一定是Array.prototype.splice，可能是Vue重写的splice)
 *
 * @param array
 * @param condition 删除判断条件
 * @returns 被删除的元素
 */
export function spliceBy<T>(array: T[], condition: (value: T) => boolean) {
    let index = array.length;
    const result = [];
    while (index--) {
        const item = array[index];
        if (condition(item)) {
            array.splice(index, 1);
            result.push(item);
        }
    }
    return result;
}

export function sleep(timeout: number) {
    return new Promise<void>(resolve => window.setTimeout(resolve, timeout));
}
