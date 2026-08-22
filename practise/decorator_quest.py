def decorator_func(func):
    def wrapper():
        print("Before the function call")
        func()
        print("After the function call")
    return wrapper

@decorator_func
def hello():
    print("Hello!")

hello()

