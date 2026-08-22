stack = []

def push(element):
    stack.append(element)
    print(f"After Adding the stack is {stack}")

def pop():
    if len(stack) ==0:
        print ("Cant perform pop function")
    removed_element = stack.pop()
    print(f"The removed element is {removed_element}")

push(5)
push(7)
push(8)
push(9)
push(10)
push(15)
push(17)
pop()
pop()

