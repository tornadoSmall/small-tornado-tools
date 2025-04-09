export type AsyncDataObj<T> = {
    /** 异步获取数据的方法，返回一个 Promise */
    getValue: () => Promise<T>;

    /** 初始化数据的方法 */
    setData: (data: T) => void;

    doReset: () => void;
};

/**
 * 使用方法：
 * await 属性.getValue() 返回数据
 * setData(data) 设置数据 设置数据后，不管是之前调用的getValue，还是之后调用的getValue都能获取到数据了
 * doReset() 重置数据状态，getValue还会等待新的setData
 * 不能写成属性装饰器 会被放在原型链上
 */
export function AsyncGetData<T>(): AsyncDataObj<T> {
    let resolveFn: (data: T) => void;
    let currentPromise = createPromise();

    function createPromise() {
        return new Promise<T>((resolve) => {
            resolveFn = resolve;
        });
    }

    return {
        setData: (data: T) => {
            resolveFn(data);
        },
        getValue: () => currentPromise.then(),
        doReset: () => {
            currentPromise = createPromise();
        },
    };
}

async function useFn () {
  const data = AsyncGetData<boolean>();
  data.getValue().then((v: boolean) => {
      console.log(1, v)
  });

  data.setData(true);

  const sameValue1 = await data.getValue();
  console.log(2, sameValue1)
  
  data.doReset();
  
  data.getValue().then((v: boolean) => {
      console.log(3, v)
  });
  data.setData(false);
  const sameValue2 = await data.getValue()
  console.log(4, v)
}
