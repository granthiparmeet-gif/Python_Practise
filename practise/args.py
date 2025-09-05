#The convention is normal arguments then args and then kwars
# def args_func(normal , *args, **kwargs):
#     print(normal)
#     for i in args:
#         print (i)




# list= ["Parmeet", "Kaustubh", "Niranjan", "Harhsa", "Pranav"]
# x=5
# args_func(x, *list)

def info (normal, *args, **kwargs):
    print (normal)
    print(f"Positional arguments is {args}")
    print(f"Keyword arguments: {kwargs}")

x= 1
y = (2,3,4)
z = { "name": "Alice", "age":"30"}
info(x,*y,**z)
