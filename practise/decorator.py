def add_info(func):
    def wrapper():
        print("Start the morning")
        func()
        print("End the evening")
    return wrapper

def give_info(func):
    def wrapper():
        print("Inform family that you reached")
        func()
        print("Inform that you have reached")
    return wrapper

@give_info
def hello():
    print("Working in the Afternoon")



hello()
